import { db, audit } from './db.mjs';
import { AppError, ensure } from './errors.mjs';
import { rateLimit } from './auth.mjs';
import { digest, randomToken, hashPassword, verifyPassword } from './security.mjs';
import { configuration } from './config.mjs';
import { object } from './validate.mjs';
import { RECOVERY_MESSAGE } from '../shared/password-recovery.mjs';
import { recoveryRequestInput, recoveryCompleteInput, administratorRecoveryInput, credentialFingerprint,
  resetLink, tokenIsCurrent, RESET_ERROR, RESET_MINUTES, recoveryEmail, recoveryMail, mailStatus } from './password-recovery-logic.mjs';
import { sendRecoveryEmail } from './password-recovery-mail.mjs';

export async function requestPasswordRecovery(input, ip) {
  const { email } = recoveryRequestInput(input);
  await rateLimit('password-recovery-ip:' + ip, 10);
  // This check runs for every mailbox, without querying whether an account exists.
  try { await rateLimit('password-recovery-email:' + email, 3); }
  catch (error) { if (!(error instanceof AppError) || error.status !== 429) throw error; return { message: RECOVERY_MESSAGE }; }
  try { await rateLimit('password-recovery-global', 300); }
  catch (error) { if (!(error instanceof AppError) || error.status !== 429) throw error; return { message: RECOVERY_MESSAGE }; }
  await db()`INSERT INTO password_recovery_mail(email,kind) VALUES(${email},'reset')`;
  return { message: RECOVERY_MESSAGE };
}
async function administratorSnapshot(actorId, password) {
  await rateLimit('password-recovery-admin:' + actorId, 10);
  const [actor] = await db()`SELECT id,role,password_hash FROM app_users WHERE id=${actorId}`;
  ensure(actor?.role === 'admin' && typeof password === 'string' && password.length <= 128 &&
    await verifyPassword(password, actor.password_hash), 403, 'Administrator password is incorrect or access is unavailable.');
  return actor;
}
async function issueToken(sql, user, requestedBy, origin) {
  const token = randomToken(), url = resetLink(origin, token);
  const expires = new Date(Date.now() + RESET_MINUTES * 60000);
  await sql`INSERT INTO password_recovery_tokens(token_hash,user_id,password_fingerprint,requested_by,expires_at)
    VALUES(${digest(token)},${user.id},${credentialFingerprint(user.password_hash)},${requestedBy},${expires})`;
  return { token_hash: digest(token), url, expires_at: expires.toISOString() };
}
export async function administratorPasswordRecovery(actorId, input) {
  const data = administratorRecoveryInput(input), actor = await administratorSnapshot(actorId, data.password);
  if (data.delivery === 'email') ensure(mailStatus().configured, 503, 'Configure recovery email first, or choose a secure one-time link.');
  return db().begin(async sql => {
    // Consistent ordering avoids deadlocks when administrators assist one another.
    const rows = await sql`SELECT id,email,role,password_hash FROM app_users WHERE id IN ${sql([actorId, data.user_id])} ORDER BY id FOR UPDATE`;
    const lockedActor = rows.find(u => u.id === actorId), target = rows.find(u => u.id === data.user_id);
    ensure(lockedActor?.role === 'admin' && lockedActor.password_hash === actor.password_hash, 403, 'Administrator credentials changed. Sign in again.');
    ensure(target, 404, 'Account not found.');
    await audit(sql, actorId, 'auth.recovery_requested', { user_id: target.id, delivery: data.delivery, reason: data.reason });
    if (data.delivery === 'email') {
      await sql`INSERT INTO password_recovery_mail(email,kind,requested_by) VALUES(${target.email},'reset',${actorId})`;
      return { delivery: 'email', message: 'Recovery email queued. The current password and sessions remain unchanged until the link is used.' };
    }
    const result = await issueToken(sql, target, actorId, configuration().origin);
    return { delivery: 'link', url: result.url, expires_at: result.expires_at,
      message: 'Shown once. Send this link only to the verified account holder through a secure channel.' };
  });
}
export async function completePasswordRecovery(input, ip) {
  await rateLimit('password-reset-ip:' + ip, 30);
  const data = recoveryCompleteInput(input), tokenHash = digest(data.token);
  const [candidate] = await db()`SELECT user_id FROM password_recovery_tokens WHERE token_hash=${tokenHash}`;
  ensure(candidate, 400, RESET_ERROR);
  const passwordHash = await hashPassword(data.password);
  return db().begin(async sql => {
    // Lock the account before the token, matching issuance and password changes.
    const [user] = await sql`SELECT id,email,password_hash FROM app_users WHERE id=${candidate.user_id} FOR UPDATE`;
    const [token] = await sql`SELECT * FROM password_recovery_tokens WHERE token_hash=${tokenHash} FOR UPDATE`;
    ensure(tokenIsCurrent(token, user), 400, RESET_ERROR);
    await sql`UPDATE app_users SET password_hash=${passwordHash} WHERE id=${user.id}`;
    await sql`DELETE FROM sessions WHERE user_id=${user.id}`;
    await sql`DELETE FROM password_recovery_tokens WHERE user_id=${user.id}`;
    // Cancel outstanding recovery requests, including a worker holding an old lease.
    await sql`DELETE FROM password_recovery_mail WHERE lower(email)=${user.email.toLowerCase()} AND kind='reset'`;
    await sql`DELETE FROM auth_attempts WHERE bucket=${digest('login-email:' + user.email.toLowerCase())}`;
    await sql`INSERT INTO password_recovery_mail(email,kind) VALUES(${user.email},'changed')`;
    await audit(sql, user.id, 'auth.password_recovered');
    return { message: 'Your password has been reset. All previous sessions and reset links are invalid. Sign in with your new password.' };
  });
}
export async function passwordRecoveryAdminStatus(query = '') {
  ensure(typeof query === 'string' && query.length <= 100, 400, 'Search must be at most 100 characters.');
  const search = query.trim().toLowerCase();
  // POSITION treats wildcard characters as text. Return no hashes, tokens or sessions.
  const users = search.length >= 2 ? await db()`SELECT id,name,email,role FROM app_users
    WHERE position(${search} in lower(email))>0 OR position(${search} in lower(name))>0 ORDER BY email LIMIT 30` : [];
  const queue = await db()`SELECT status,count(*)::integer AS count FROM password_recovery_mail GROUP BY status`;
  return { users, mail: mailStatus(), queue, reset_minutes: RESET_MINUTES };
}
export async function testRecoveryEmail(actorId, input) {
  const data = object(input);
  ensure(Object.keys(data).every(k => k === 'password'), 400, 'Unsupported email test field.');
  await administratorSnapshot(actorId, data.password);
  ensure(mailStatus().configured, 503, 'Configure recovery email before sending a delivery test.');
  const [user] = await db()`SELECT email FROM app_users WHERE id=${actorId}`;
  await db()`INSERT INTO password_recovery_mail(email,kind,requested_by) VALUES(${user.email},'test',${actorId})`;
  return { message: 'Test email queued to your own account email address.' };
}
// Internal injectable sender for the isolated database tests; never supplied by an API request.
export async function processRecoveryMail({ sql = db(), send = sendRecoveryEmail, origin = configuration().origin } = {}) {
  const lease = randomToken();
  const job = await sql.begin(async tx => {
    await tx`UPDATE password_recovery_mail SET status=CASE WHEN attempts<3 THEN 'queued' ELSE 'failed' END,
      lease_token=NULL,lease_until=NULL,last_error='DELIVERY_INTERRUPTED'
      WHERE status='sending' AND lease_until<now()`;
    const [row] = await tx`SELECT * FROM password_recovery_mail WHERE status='queued' AND attempts<3
      AND available_at<=now() AND expires_at>now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!row) return null;
    const [claimed] = await tx`UPDATE password_recovery_mail SET status='sending',attempts=attempts+1,
      lease_token=${lease},lease_until=now()+interval '2 minutes' WHERE id=${row.id} RETURNING *`;
    return claimed;
  });
  if (!job) return false;
  let issuedHash = null;
  try {
    const prepared = await sql.begin(async tx => {
      const [user] = await tx`SELECT id,email,password_hash FROM app_users WHERE lower(email)=${job.email.toLowerCase()} FOR UPDATE`;
      if (!user) return null;
      // A password reset can remove the job while a worker is looking up its recipient.
      const [current] = await tx`SELECT id FROM password_recovery_mail WHERE id=${job.id} AND lease_token=${lease} AND status='sending'`;
      if (!current) return null;
      const address = recoveryEmail(user.email);
      if (job.kind !== 'reset') return { address, message: recoveryMail(job.kind, origin) };
      const issued = await issueToken(tx, user, job.requested_by, origin); issuedHash = issued.token_hash;
      return { address, message: recoveryMail('reset', origin, issued.url) };
    });
    if (prepared) await send(prepared.address, prepared.message);
    await sql`UPDATE password_recovery_mail SET status=${prepared ? 'sent' : 'ignored'},finished_at=now(),
      lease_token=NULL,lease_until=NULL,last_error='' WHERE id=${job.id} AND lease_token=${lease}`;
  } catch {
    // No SMTP response, address, message body, URL or credential is logged/persisted.
    if (issuedHash) await sql`DELETE FROM password_recovery_tokens WHERE token_hash=${issuedHash}`;
    await sql`UPDATE password_recovery_mail SET status=CASE WHEN attempts<3 THEN 'queued' ELSE 'failed' END,
      available_at=now()+interval '2 minutes',lease_token=NULL,lease_until=NULL,last_error='SMTP_DELIVERY_FAILED',
      finished_at=CASE WHEN attempts>=3 THEN now() ELSE NULL END WHERE id=${job.id} AND lease_token=${lease}`;
  }
  return true;
}
export async function recoveryMailTick() {
  await db()`DELETE FROM password_recovery_tokens WHERE expires_at<now()`;
  await db()`DELETE FROM password_recovery_mail WHERE expires_at<now() OR finished_at<now()-interval '1 day'`;
  if (mailStatus().configured) await processRecoveryMail();
}

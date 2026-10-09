import { db, audit } from './db.mjs';
import { AppError, ensure } from './errors.mjs';
import { rateLimit } from './auth.mjs';
import { digest, randomToken, hashPassword, verifyPassword } from './security.mjs';
import { configuration } from './config.mjs';
import { object } from './validate.mjs';
import { RECOVERY_MESSAGE } from '../shared/password-recovery.mjs';
import { recoveryRequestInput, recoveryCompleteInput, administratorRecoveryInput, credentialFingerprint,
  resetLink, tokenIsCurrent, RESET_ERROR, RESET_MINUTES, recoveryEmail, recoveryMail } from './password-recovery-logic.mjs';
import { sendRecoveryEmail, recoveryDeliveryStatus, deliveryConfiguration, suppressedEmail } from './password-recovery-mail.mjs';
import { reserveEmailDispatch, knownEmailRejection } from './email-dispatch.mjs';
import { deliveryMessageId } from './email-outbox.mjs';
import { smtpHistoryCode } from './smtp-errors.mjs';

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
  if (data.delivery === 'email') ensure((await recoveryDeliveryStatus()).configured, 503, 'Configure recovery email first, or choose a secure one-time link.');
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
  const deliveries=await db()`SELECT id,kind,status,attempts,provider,provider_id,message_id,last_error,created_at,accepted_at,delivered_at,finished_at
    FROM password_recovery_mail ORDER BY created_at DESC LIMIT 30`;
  return { users, mail: await recoveryDeliveryStatus(), queue, deliveries, reset_minutes: RESET_MINUTES };
}
export async function testRecoveryEmail(actorId, input) {
  const data = object(input);
  ensure(Object.keys(data).every(k => k === 'password'), 400, 'Unsupported email test field.');
  await administratorSnapshot(actorId, data.password);
  ensure((await recoveryDeliveryStatus()).configured, 503, 'Configure recovery email before sending a delivery test.');
  const [user] = await db()`SELECT email FROM app_users WHERE id=${actorId}`;
  await db()`INSERT INTO password_recovery_mail(email,kind,requested_by) VALUES(${user.email},'test',${actorId})`;
  return { message: 'Test email queued to your own account email address.' };
}
// Internal injectable sender for the isolated database tests; never supplied by an API request.
export async function processRecoveryMail({ sql = db(), send = sendRecoveryEmail, origin = configuration().origin } = {}) {
  const config=await deliveryConfiguration(sql);
  if(send===sendRecoveryEmail&&(!config.enabled||!config.configured))return false;
  const lease = randomToken();
  let ignored = false;
  const job = await sql.begin(async tx => {
    await tx`UPDATE password_recovery_mail SET status=CASE WHEN dispatch_started_at IS NOT NULL THEN 'uncertain' WHEN attempts<3 THEN 'queued' ELSE 'failed' END,
      lease_token=NULL,lease_until=NULL,last_error=CASE WHEN dispatch_started_at IS NOT NULL THEN 'DELIVERY_UNCERTAIN' ELSE 'DELIVERY_INTERRUPTED' END,
      finished_at=CASE WHEN dispatch_started_at IS NOT NULL OR attempts>=3 THEN now() ELSE NULL END
      WHERE status='sending' AND lease_until<now()`;
    // Public responses remain account-blind. Only the worker discards unknown
    // recipients, in bounded batches, before they can consume SMTP capacity.
    const discarded = await tx`WITH candidates AS (
      SELECT r.id FROM password_recovery_mail r WHERE r.status='queued' AND r.attempts<3
        AND r.available_at<=now() AND r.expires_at>now()
        AND NOT EXISTS (SELECT 1 FROM app_users u WHERE lower(u.email)=lower(r.email))
      ORDER BY r.created_at,r.id FOR UPDATE OF r SKIP LOCKED LIMIT 100
    ) UPDATE password_recovery_mail SET status='ignored',attempts=attempts+1,
      finished_at=now(),lease_token=NULL,lease_until=NULL,last_error=''
      WHERE id IN (SELECT id FROM candidates) RETURNING id`;
    ignored = discarded.length > 0;
    const [row] = await tx`SELECT r.* FROM password_recovery_mail r WHERE r.status='queued' AND r.attempts<3
      AND r.available_at<=now() AND r.expires_at>now()
      AND EXISTS (SELECT 1 FROM app_users u WHERE lower(u.email)=lower(r.email))
      ORDER BY r.created_at,r.id FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!row) return null;
    if(!await reserveEmailDispatch(tx,config,'recovery'))return null;
    const [claimed] = await tx`UPDATE password_recovery_mail SET status='sending',attempts=attempts+1,
      lease_token=${lease},lease_until=now()+interval '2 minutes' WHERE id=${row.id} RETURNING *`;
    return claimed;
  });
  if (!job) return ignored;
  let issuedHash = null;
  try {
    const prepared = await sql.begin(async tx => {
      const [user] = await tx`SELECT id,email,password_hash FROM app_users WHERE lower(email)=${job.email.toLowerCase()} FOR UPDATE`;
      if (!user) return null;
      // A password reset can remove the job while a worker is looking up its recipient.
      const [current] = await tx`SELECT id FROM password_recovery_mail WHERE id=${job.id} AND lease_token=${lease} AND status='sending'`;
      if (!current) return null;
      const address = recoveryEmail(user.email);
      if(await suppressedEmail(address,tx))return {suppressed:true};
      if (job.kind !== 'reset') return { address, message: recoveryMail(job.kind, origin) };
      const issued = await issueToken(tx, user, job.requested_by, origin); issuedHash = issued.token_hash;
      return { address, message: recoveryMail('reset', origin, issued.url) };
    });
    if(prepared?.suppressed){
      await sql`UPDATE password_recovery_mail SET status='suppressed',finished_at=now(),lease_token=NULL,lease_until=NULL,
        last_error='RECIPIENT_SUPPRESSED' WHERE id=${job.id} AND lease_token=${lease}`;
      return true;
    }
    let result=null;
    const messageId=deliveryMessageId('recovery',job.id,origin);
    if(prepared){
      const reserved=await sql`UPDATE password_recovery_mail SET message_id=${messageId},recipient_hash=${digest(prepared.address)},provider=${config.provider},dispatch_started_at=now(),lease_until=now()+interval '2 minutes'
        WHERE id=${job.id} AND lease_token=${lease} AND status='sending' AND lease_until>now() AND expires_at>now() RETURNING id`;
      if(!reserved.length){
        if(issuedHash)await sql`DELETE FROM password_recovery_tokens WHERE token_hash=${issuedHash}`;
        return true;
      }
      result=await send(prepared.address,prepared.message,{messageId,tag:'cardshelf-recovery-'+job.kind,configuration:config});
    }
    // An injected legacy SMTP test sender may return no metadata; existing queues
    // retain their historic 'sent' state. Provider acceptance is never delivery.
    const status=!prepared?'ignored':result?'accepted':'sent';
    await sql`UPDATE password_recovery_mail SET status=CASE WHEN status='sending' THEN ${status} ELSE status END,
      provider=${result?.provider||config.provider},provider_id=${result?.provider_id?String(result.provider_id):null},message_id=${result?.message_id||messageId},
      accepted_at=CASE WHEN ${!!prepared} THEN coalesce(accepted_at,now()) ELSE accepted_at END,
      finished_at=CASE WHEN ${status}='accepted' THEN finished_at ELSE now() END,
      lease_token=NULL,lease_until=NULL,last_error=CASE WHEN status='sending' THEN '' ELSE last_error END WHERE id=${job.id} AND lease_token=${lease}`;
  } catch (error) {
    // No SMTP response, address, message body, URL or credential is logged/persisted.
    const suppressed=error?.emailCode==='RECIPIENT_SUPPRESSED',rejected=knownEmailRejection(error);
    // A potentially accepted reset remains redeemable until its normal expiry.
    // Never resend it automatically or store its plaintext token in history.
    const [state]=await sql`SELECT dispatch_started_at FROM password_recovery_mail WHERE id=${job.id} AND lease_token=${lease}`;
    const uncertain=!!state?.dispatch_started_at&&!suppressed&&!rejected;
    if (issuedHash&&!uncertain) await sql`DELETE FROM password_recovery_tokens WHERE token_hash=${issuedHash}`;
    await sql`UPDATE password_recovery_mail SET status=CASE WHEN ${suppressed} THEN 'suppressed' WHEN ${uncertain} THEN 'uncertain' WHEN attempts<3 THEN 'queued' ELSE 'failed' END,
      available_at=now()+interval '2 minutes',lease_token=NULL,lease_until=NULL,
      dispatch_started_at=CASE WHEN ${suppressed||rejected} THEN NULL ELSE dispatch_started_at END,
      last_error=${suppressed?'RECIPIENT_SUPPRESSED':uncertain?'DELIVERY_UNCERTAIN':smtpHistoryCode(error)||(error?.emailProvider==='postal'?'EMAIL_DELIVERY_FAILED':'SMTP_DELIVERY_FAILED')},
      finished_at=CASE WHEN ${suppressed||uncertain} OR attempts>=3 THEN now() ELSE NULL END WHERE id=${job.id} AND lease_token=${lease} AND status='sending'`;
  }
  return true;
}
export async function recoveryMailTick() {
  await db()`DELETE FROM password_recovery_tokens WHERE expires_at<now()`;
  await db()`UPDATE password_recovery_mail SET status='expired',finished_at=now(),lease_token=NULL,lease_until=NULL
    WHERE expires_at<now() AND (status='queued' OR status='sending' AND lease_until<now())`;
  await db()`DELETE FROM password_recovery_mail WHERE coalesce(finished_at,accepted_at,created_at)<now()-interval '30 days' AND status<>'sending'`;
  if ((await recoveryDeliveryStatus()).configured) await processRecoveryMail();
}

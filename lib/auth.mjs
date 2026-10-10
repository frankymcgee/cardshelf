import { db, audit } from './db.mjs';
import { configuration } from './config.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { digest, hashPassword, safeEqual, verifyPassword } from './security.mjs';
import { enqueueEmail } from './email-outbox.mjs';
import { queueEmailVerification } from './email-verification.mjs';
import { readFullSession, passwordLoginResult, createAccountSession, revokeAccountAuthentication, securityRateLimit, accountFactors, requireRecentStrongAuth } from './account-security.mjs';
import { publicUser, validToken } from './account-security-logic.mjs';
export async function needsSetup() { return Number((await db()`SELECT count(*) AS n FROM app_users`)[0].n) === 0; }
export async function sessionUser(token) {
  const user = await readFullSession(token);
  return user ? publicUser(user) : null;
}
export const rateLimit = securityRateLimit;
export async function setup(input, ip) {
  await rateLimit('setup:' + ip, 20);
  const data = v.object(input), cfg = configuration();
  ensure(cfg.bootstrapToken.length >= 32 && !cfg.bootstrapToken.startsWith('REPLACE_'), 503, 'Set a secure BOOTSTRAP_TOKEN on the server before setup.');
  ensure(safeEqual(v.text(data.token, 'Setup token', 1, 256), cfg.bootstrapToken), 403, 'The setup token is incorrect.');
  const email = v.email(data.email), name = v.text(data.name, 'Name', 1, 80);
  const hash = await hashPassword(v.password(data.password));
  return db().begin(async sql => {
    await sql`SELECT pg_advisory_xact_lock(72490319)`;
    ensure(Number((await sql`SELECT count(*) AS n FROM app_users`)[0].n) === 0, 409, 'Setup has already been completed.');
    const [user] = await sql`INSERT INTO app_users(email, name, password_hash, role, email_verification_required, email_verification_grandfathered_at) VALUES (${email}, ${name}, ${hash}, 'admin', false, now()) RETURNING *`;
    // Bootstrap-token setup must retain access to configure outgoing mail.
    // The address is explicitly grandfathered, never falsely marked verified.
    await audit(sql, user.id, 'setup.complete');
    return passwordLoginResult(sql, user);
  });
}
export async function login(input, ip) {
  const data = v.object(input), email = v.email(data.email);
  await rateLimit('login-ip:' + ip, 100); await rateLimit('login-email:' + email, 10);
  ensure(typeof data.password === 'string' && data.password.length >= 1 && data.password.length <= 128, 400, 'Enter your password.');
  const supplied = data.password;
  const [record] = await db()`SELECT * FROM app_users WHERE lower(email) = ${email}`;
  // Perform the same expensive hash operation for unknown accounts.
  const valid = record ? await verifyPassword(supplied, record.password_hash) : (await hashPassword(supplied), false);
  ensure(valid, 401, 'Email or password is incorrect.');
  return db().begin(async sql => {
    // Prevent an in-flight login using an old hash after a password change.
    const [locked] = await sql`SELECT * FROM app_users WHERE id = ${record.id} FOR UPDATE`;
    ensure(locked?.password_hash === record.password_hash, 401, 'Email or password is incorrect.');
    await sql`DELETE FROM auth_attempts WHERE bucket = ${digest('login-email:' + email)}`;
    const result = await passwordLoginResult(sql, locked);
    await audit(sql, record.id, result.token ? 'auth.login' : 'auth.password_verified');
    return result;
  });
}
export async function logout(token, pendingToken) {
  const sessionHash = validToken(token) ? digest(token) : null;
  const pendingHash = validToken(pendingToken) ? digest(pendingToken) : null;
  if (!sessionHash && !pendingHash) return;
  const ancestor = pendingHash ? [pendingHash] : [];
  await db().begin(async sql => {
    // Match account-security's lock order. Completion may win the lock and
    // rotate away the pending cookie before this transaction resumes. Its
    // bounded hashed ancestry lets cancellation still revoke only that flow.
    await sql`SELECT id FROM app_users WHERE id IN (
      SELECT user_id FROM sessions WHERE token_hash=${sessionHash}
        OR (${!!pendingHash} AND pending_auth_expires_at>now() AND pending_auth_hashes @> ${ancestor}::text[])
      UNION SELECT user_id FROM account_pending_auth WHERE token_hash=${pendingHash}
        OR (${!!pendingHash} AND expires_at>now() AND pending_auth_hashes @> ${ancestor}::text[])
    ) ORDER BY id FOR UPDATE`;
    const sessions = await sql`DELETE FROM sessions WHERE token_hash=${sessionHash}
      OR (${!!pendingHash} AND pending_auth_expires_at>now() AND pending_auth_hashes @> ${ancestor}::text[]) RETURNING token_hash`;
    const pending = await sql`DELETE FROM account_pending_auth WHERE token_hash=${pendingHash}
      OR (${!!pendingHash} AND expires_at>now() AND pending_auth_hashes @> ${ancestor}::text[]) RETURNING token_hash`;
    const contexts = [...new Set([sessionHash,pendingHash,...sessions.map(row => row.token_hash),...pending.map(row => row.token_hash)].filter(Boolean))];
    await sql`DELETE FROM account_security_challenges WHERE context_hash IN ${sql(contexts)}`;
  });
}
export async function changePassword(userId, input, sessionToken) {
  const data = v.object(input), next = v.password(data.password);
  await rateLimit('password-change:' + userId, 10);
  const [record] = await db()`SELECT password_hash FROM app_users WHERE id=${userId}`;
  ensure(record && await verifyPassword(data.current_password, record.password_hash), 403, 'The current password is incorrect.');
  const hash = await hashPassword(next);
  return db().begin(async sql => {
    const [locked] = await sql`SELECT * FROM app_users WHERE id=${userId} FOR UPDATE`;
    ensure(locked?.password_hash === record.password_hash, 409, 'Your password changed in another session. Sign in again.');
    const session = sessionToken ? await readFullSession(sessionToken, sql) : null;
    const factors = await accountFactors(sql,userId);
    if (factors.enrolled) await requireRecentStrongAuth(sessionToken, sql);
    ensure(session?.id === userId || !sessionToken && !factors.enrolled && !locked.mfa_reset_required,
      401, 'Sign in with your existing factors before changing your password.');
    const [user] = await sql`UPDATE app_users SET password_hash=${hash},security_version=security_version+1 WHERE id=${userId} RETURNING *`;
    await revokeAccountAuthentication(sql,userId);
    await sql`DELETE FROM password_recovery_tokens WHERE user_id=${userId}`;
    await sql`DELETE FROM password_recovery_mail WHERE kind='reset' AND lower(email) IN
      (SELECT lower(email) FROM app_users WHERE id=${userId})`;
    await enqueueEmail(sql,{eventKey:'password-changed:'+userId+':'+digest(hash),kind:'password_changed',userId});
    await audit(sql,userId,'auth.password_changed');
    // Preserve the original factor authentication timestamp. A password change
    // does not refresh MFA or turn an enrollment/recovery token into a session.
    return createAccountSession(sql,user,session?.auth_strength || 'password',session?.strong_authenticated_at || null,session);
  });
}
export async function createUser(actorId, input) {
  const o = v.object(input), email = v.email(o.email), name = v.text(o.name, 'Name', 1, 80);
  const hash = await hashPassword(v.password(o.password));
  try {
    return await db().begin(async sql => {
      const [user] = await sql`INSERT INTO app_users(email, name, password_hash, email_verification_required, email_verification_grandfathered_at) VALUES (${email}, ${name}, ${hash}, true, NULL) RETURNING id, email, name, role`;
      await queueEmailVerification(sql,user.id,user.email);
      await audit(sql, actorId, 'user.create', { user_id: user.id }); return user;
    });
  } catch (error) { if (error.code === '23505') ensure(false, 409, 'That email address is already registered.'); throw error; }
}

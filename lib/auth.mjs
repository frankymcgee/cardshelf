import { db, audit } from './db.mjs';
import { configuration } from './config.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { digest, hashPassword, randomToken, safeEqual, verifyPassword } from './security.mjs';
export async function needsSetup() { return Number((await db()`SELECT count(*) AS n FROM app_users`)[0].n) === 0; }
export async function sessionUser(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [user] = await db()`SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN app_users u ON u.id = s.user_id
    WHERE s.token_hash = ${digest(token)} AND s.expires_at > now()`;
  return user || null;
}
async function newSession(sql, userId) {
  const token = randomToken();
  const expires = new Date(Date.now() + configuration().sessionSeconds * 1000);
  await sql`INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (${digest(token)}, ${userId}, ${expires})`;
  return token;
}
export async function rateLimit(bucket, limit = 10) {
  const [record] = await db()`INSERT INTO auth_attempts(bucket, attempts, reset_at)
    VALUES (${digest(bucket)}, 1, now() + interval '15 minutes')
    ON CONFLICT(bucket) DO UPDATE SET
      attempts = CASE WHEN auth_attempts.reset_at < now() THEN 1 ELSE auth_attempts.attempts + 1 END,
      reset_at = CASE WHEN auth_attempts.reset_at < now() THEN now() + interval '15 minutes' ELSE auth_attempts.reset_at END
    RETURNING attempts`;
  ensure(record.attempts <= limit, 429, 'Too many attempts. Try again after 15 minutes.');
}
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
    const [user] = await sql`INSERT INTO app_users(email, name, password_hash, role) VALUES (${email}, ${name}, ${hash}, 'admin') RETURNING id, email, name, role`;
    const token = await newSession(sql, user.id);
    await audit(sql, user.id, 'setup.complete');
    return { user, token };
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
    const [locked] = await sql`SELECT password_hash FROM app_users WHERE id = ${record.id} FOR UPDATE`;
    ensure(locked?.password_hash === record.password_hash, 401, 'Email or password is incorrect.');
    await sql`DELETE FROM auth_attempts WHERE bucket = ${digest('login-email:' + email)}`;
    const token = await newSession(sql, record.id);
    await audit(sql, record.id, 'auth.login');
    return { user: { id: record.id, email: record.email, name: record.name, role: record.role }, token };
  });
}
export async function logout(token) { if (token) await db()`DELETE FROM sessions WHERE token_hash = ${digest(token)}`; }
export async function changePassword(userId, input) {
  const data = v.object(input), next = v.password(data.password);
  const [record] = await db()`SELECT password_hash FROM app_users WHERE id = ${userId}`;
  ensure(await verifyPassword(data.current_password, record.password_hash), 403, 'The current password is incorrect.');
  const hash = await hashPassword(next);
  return db().begin(async sql => {
    const changed = await sql`UPDATE app_users SET password_hash = ${hash} WHERE id = ${userId} AND password_hash = ${record.password_hash} RETURNING id`;
    ensure(changed.length === 1, 409, 'Your password changed in another session. Sign in again.');
    await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
    await sql`DELETE FROM password_recovery_tokens WHERE user_id = ${userId}`;
    await sql`DELETE FROM password_recovery_mail WHERE kind='reset' AND lower(email) IN
      (SELECT lower(email) FROM app_users WHERE id=${userId})`;
    await audit(sql, userId, 'auth.password_changed');
    return newSession(sql, userId);
  });
}
export async function createUser(actorId, input) {
  const o = v.object(input), email = v.email(o.email), name = v.text(o.name, 'Name', 1, 80);
  const hash = await hashPassword(v.password(o.password));
  try {
    return await db().begin(async sql => {
      const [user] = await sql`INSERT INTO app_users(email, name, password_hash) VALUES (${email}, ${name}, ${hash}) RETURNING id, email, name, role`;
      await audit(sql, actorId, 'user.create', { user_id: user.id }); return user;
    });
  } catch (error) { if (error.code === '23505') ensure(false, 409, 'That email address is already registered.'); throw error; }
}

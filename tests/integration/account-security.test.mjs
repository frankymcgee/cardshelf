// Real HTTP/PostgreSQL/cryptography regression tests. Uses only synthetic accounts
// in an explicitly disposable database; no real SMTP delivery or hardware.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { generate } from 'otplib';
import { hashPassword, digest, randomToken } from '../../lib/security.mjs';
import { softwareAuthenticator } from '../helpers/account-security-fixtures.mjs';
import { closeDatabase } from '../../lib/db.mjs';
import { login as directLogin, sessionUser } from '../../lib/auth.mjs';
import { recoverAdminMfa } from '../../scripts/recover-admin-mfa.mjs';

const base = process.env.TEST_BASE_URL, databaseUrl = process.env.DATABASE_URL;
if (process.env.ALLOW_TEST_DATABASE !== 'yes' || !base || !new URL(databaseUrl || 'http://invalid').pathname.endsWith('_test') || process.env.RECOVERY_EMAIL_ENABLED === 'true') {
  throw new Error('Use a disposable _test database and disable real recovery email.');
}
const sql = postgres(databaseUrl, { max: 6 }), origin = process.env.APP_ORIGIN || base;
const password = 'Synthetic account security password 123!', nextPassword = 'Synthetic replacement password 456!';
const run = randomUUID().replaceAll('-', ''), accounts = [], rateBuckets = new Set();
// This suite is sequential and may be rerun on the same disposable harness. Save
// and restore only its loopback IP limits; per-account/context retry limits stay
// intact and are explicitly exercised below. No production or remote buckets.
const loopbackBuckets = ['127.0.0.1', '::ffff:127.0.0.1', '::1'].flatMap(ip =>
  ['security-ip:', 'login-ip:', 'email-verify-ip:', 'password-reset-ip:'].map(prefix => digest(prefix + ip)));
const uuid = randomUUID();
const protectedReads = ['/api/dashboard', '/api/admin/users', '/api/admin/platform', '/api/admin/password-recovery',
  '/api/account/membership', '/api/emails/preferences', '/api/binders', `/api/binders/${uuid}/wallpaper`,
  `/api/binders/${uuid}/collection-sync`, '/api/scans', '/api/battle', '/api/marketplace/access'];

async function request(path, { cookie, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(base + path, { method, redirect: 'manual', headers: {
    Origin: origin, 'X-Requested-With': 'cardshelf', ...(cookie ? { Cookie: cookie } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers,
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text(); let data;
  try { data = JSON.parse(text); } catch { data = text; }
  const setCookies = response.headers.getSetCookie();
  const cookies = Object.fromEntries(setCookies.map(value => value.split(';')[0]).map(value => {
    const equals = value.indexOf('='); return [value.slice(0, equals), value.slice(equals + 1)];
  }));
  return { status: response.status, data, headers: response.headers, setCookies, cookies,
    session: cookies.cardshelf_session ? 'cardshelf_session=' + cookies.cardshelf_session : undefined,
    pending: cookies.cardshelf_pending ? 'cardshelf_pending=' + cookies.cardshelf_pending : undefined };
}
const post = (path, cookie, body = {}, headers) => request(path, { cookie, method: 'POST', body, headers });
function ok(result) { assert.equal(result.status, 200, JSON.stringify(result.data)); return result; }
function denied(result) { assert.ok([400, 401, 403, 409, 429].includes(result.status), JSON.stringify(result)); return result; }
async function account(kind, { role = 'admin', verified = true, required = false } = {}) {
  const id = randomUUID(), email = `security-${kind}-${run}@example.test`;
  const user = { id, email, password }; accounts.push(user);
  await sql`INSERT INTO app_users(id,email,name,password_hash,role,email_verified_at,email_verification_required)
    VALUES(${id},${email},${kind},${await hashPassword(password)},${role},${verified ? new Date() : null},${required})`;
  rateBuckets.add(digest('login-email:' + email));
  return user;
}
async function login(user, supplied = user.password) { return post('/api/login', undefined, { email: user.email, password: supplied }); }
async function seededSession(user, { strength = 'password', version } = {}) {
  const token = randomToken();
  const [record] = await sql`SELECT security_version FROM app_users WHERE id=${user.id}`;
  await sql`INSERT INTO sessions(token_hash,user_id,expires_at,security_version,auth_strength,strong_authenticated_at)
    VALUES(${digest(token)},${user.id},now()+interval '1 hour',${version ?? record.security_version},${strength},${strength === 'mfa' ? new Date() : null})`;
  return 'cardshelf_session=' + token;
}
async function enrollTotp(user, cookie, input = {}) {
  cookie ||= ok(await login(user)).session;
  const begin = ok(await post('/api/security/totp/begin', cookie, { password: user.password, label: 'Synthetic authenticator', ...input }));
  assert.ok(begin.data.secret); assert.ok(begin.data.uri.startsWith('otpauth:'));
  // Use the current step; the login test uses the next accepted skew window.
  // A previous-step enrollment would flake if HTTP crosses a 30-second boundary.
  const code = await generate({ secret: begin.data.secret });
  const finish = ok(await post('/api/security/totp/verify', cookie, { challenge_token: begin.data.challenge_token, code }));
  assert.ok(finish.session);
  return { ...finish, secret: begin.data.secret, code, challenge: begin.data.challenge_token, previous: cookie };
}
async function enrollPasskey(user) {
  const previous = ok(await login(user)).session, authenticator = softwareAuthenticator();
  const begin = ok(await post('/api/security/passkeys/begin', previous, { password: user.password, label: 'Synthetic passkey' }));
  const result = ok(await post('/api/security/passkeys/verify', previous, { challenge_token: begin.data.challenge_token,
    response: authenticator.registration(begin.data.options, origin) }));
  return { ...result, authenticator, previous, counter: 0 };
}
async function passkeyProof(user, enrolled, cookie) {
  const begin = ok(await post('/api/security/passkeys/authenticate/begin', cookie, { purpose: 'reauth', password: user.password }));
  const result = ok(await post('/api/security/passkeys/authenticate/verify', cookie, { purpose: 'reauth', challenge_token: begin.data.challenge_token,
    response: enrolled.authenticator.assertion(begin.data.options, origin, { counter: ++enrolled.counter }) }));
  assert.match(result.data.proof_token, /^[a-f0-9]{64}$/); return result.data.proof_token;
}
async function assertRestricted(cookie) {
  assert.equal((await request('/api/session', { cookie })).data.user, null);
  for (const path of protectedReads) {
    const result = await request(path, { cookie });
    assert.equal(result.status, 401, path + ': ' + JSON.stringify(result.data));
  }
  for (const path of ['/api/password', '/api/admin/users', '/api/collection/wishlist', `/api/binders/${uuid}/tracking`, `/api/binders/${uuid}/collection-sync`]) {
    assert.equal((await post(path, cookie, {})).status, 401, path);
  }
}

await test('account security boundaries across production HTTP routes', async t => {
  const savedIpAttempts = await sql`SELECT * FROM auth_attempts WHERE bucket IN ${sql(loopbackBuckets)}`;
  t.beforeEach(async () => { await sql`DELETE FROM auth_attempts WHERE bucket IN ${sql(loopbackBuckets)}`; });
  try {
    await t.test('existing password-only users retain access during staged rollout', async () => {
      const user = await account('legacy', { verified: false });
      const result = ok(await login(user)); assert.ok(result.session); assert.ok(!result.pending);
      assert.equal((await request('/api/session', { cookie: result.session })).data.user.id, user.id);
      assert.equal((await request('/api/admin/users', { cookie: result.session })).status, 200);
      const [row] = await sql`SELECT auth_strength,security_version FROM sessions WHERE token_hash=${digest(result.cookies.cardshelf_session)}`;
      assert.equal(row.auth_strength, 'password'); assert.equal(Number(row.security_version), 0);
      assert.ok(result.setCookies.some(value => /cardshelf_session=.*HttpOnly/i.test(value) && /SameSite=Strict/i.test(value)));
    });

    await t.test('version mismatch and forced reset invalidate existing strong sessions centrally', async () => {
      const user = await account('revoked');
      const stale = await seededSession(user);
      assert.equal((await request('/api/session', { cookie: stale })).data.user.id, user.id);
      await sql`UPDATE app_users SET security_version=security_version+1 WHERE id=${user.id}`;
      await assertRestricted(stale);
      const forced = await seededSession(user);
      assert.equal((await request('/api/session', { cookie: forced })).data.user.id, user.id);
      await sql`UPDATE app_users SET mfa_reset_required=true WHERE id=${user.id}`;
      await assertRestricted(forced);
      const pending = ok(await login(user)); assert.ok(pending.pending); assert.ok(!pending.session);
      await assertRestricted(pending.pending);
      await assertRestricted(pending.pending.replace('cardshelf_pending=', 'cardshelf_session='));
    });

    await t.test('explicit administrator rollout enforces enrollment while preserving ordinary-user access', async () => {
      const admin = await account('required-admin'), ordinary = await account('required-user', { role: 'user' });
      const old = await seededSession(admin), previous = process.env.CARDSHELF_REQUIRE_ADMIN_MFA;
      const ip = 'security-rollout-' + run; rateBuckets.add(digest('login-ip:' + ip));
      try {
        process.env.CARDSHELF_REQUIRE_ADMIN_MFA = 'true';
        assert.equal(await sessionUser(old.slice('cardshelf_session='.length)), null);
        const pending = await directLogin({ email: admin.email, password }, ip);
        assert.ok(!pending.token); assert.ok(pending.pending_token); assert.equal(pending.pending.scope, 'enrollment');
        await assertRestricted('cardshelf_pending=' + pending.pending_token);
        // The HTTP server retains its own rollout setting. Its security context
        // still enforces the enrollment scope generated by the real login code.
        denied(await post('/api/security/totp/login', 'cardshelf_pending=' + pending.pending_token, { code: '123456' }));
        const completed = await enrollTotp(admin, 'cardshelf_pending=' + pending.pending_token);
        assert.equal((await sessionUser(completed.cookies.cardshelf_session)).id, admin.id);
        assert.ok((await directLogin({ email: ordinary.email, password }, ip)).token);
      } finally {
        if (previous === undefined) delete process.env.CARDSHELF_REQUIRE_ADMIN_MFA;
        else process.env.CARDSHELF_REQUIRE_ADMIN_MFA = previous;
      }
    });

    await t.test('unverified mandatory accounts cannot obtain either authentication cookie', async () => {
      const user = await account('email-gate', { verified: false, required: true });
      const result = await login(user);
      assert.ok([200, 403].includes(result.status), JSON.stringify(result.data));
      assert.ok(!result.session); assert.ok(!result.pending);
      assert.equal((await sql`SELECT * FROM sessions WHERE user_id=${user.id}`).length, 0);
      assert.equal((await sql`SELECT * FROM account_pending_auth WHERE user_id=${user.id}`).length, 0);
      await assertRestricted(await seededSession(user, { strength: 'mfa' }));
      // An unknown or wrong password must never disclose verification state.
      const bad = await login(user, 'incorrect password'); assert.equal(bad.status, 401);
      assert.ok(!/verification_required/.test(JSON.stringify(bad.data)));
    });

    await t.test('email verification requires token plus password, binds version and mailbox, and is single use', async () => {
      const user = await account('email-token', { verified: false, required: true });
      const [record] = await sql`SELECT * FROM app_users WHERE id=${user.id}`;
      async function issue(overrides = {}) {
        const token = randomToken();
        await sql`INSERT INTO email_verification_tokens(token_hash,user_id,email,password_fingerprint,security_version,expires_at)
          VALUES(${digest(token)},${user.id},${overrides.email || user.email},${digest(record.password_hash)},${overrides.version ?? record.security_version},${overrides.expiry || new Date(Date.now() + 3600000)})`;
        return token;
      }
      const complete = (token, supplied = password) => post('/api/public/email-verification/complete', undefined, { token, password: supplied });
      const token = await issue();
      const page = await request('/verify-email'); assert.equal(page.status, 200);
      assert.match(page.headers.get('cache-control'), /no-store/);
      assert.match(page.headers.get('x-robots-tag'), /noindex/); assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
      assert.ok((await request('/api/public/email-verification/complete')).status >= 400);
      assert.equal((await post('/api/public/email-verification/complete', undefined, { token, password }, { Origin: 'https://evil.test' })).status, 403);
      assert.equal((await sql`SELECT * FROM email_verification_tokens WHERE token_hash=${digest(token)}`).length, 1);
      denied(await complete(token, 'wrong password'));
      denied(await complete(await issue({ email: 'different@example.test' })));
      denied(await complete(await issue({ version: 42 })));
      denied(await complete(await issue({ expiry: new Date(Date.now() - 1000) })));
      const results = await Promise.all([complete(token), complete(token)]);
      assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
      for (const result of results) { assert.ok(!result.session); assert.ok(!result.pending); assert.match(result.headers.get('cache-control'), /no-store/); }
      const [verified] = await sql`SELECT email_verified_at,email_verification_required FROM app_users WHERE id=${user.id}`;
      assert.ok(verified.email_verified_at); assert.equal(verified.email_verification_required, false);
      assert.ok(ok(await login(user)).session);
    });

    await t.test('TOTP enrollment rotates sessions, hides secrets, rejects replay and blocks password-only access', async () => {
      const user = await account('totp'), initial = ok(await login(user)).session;
      denied(await post('/api/security/totp/begin', initial, { password: 'wrong' }));
      assert.equal((await post('/api/security/totp/begin', initial, { password }, { Origin: 'https://evil.test' })).status, 403);
      const enrolled = await enrollTotp(user, initial);
      assert.equal(enrolled.data.recovery_codes.length, 10);
      const [factor] = await sql`SELECT * FROM account_totp_credentials WHERE user_id=${user.id}`;
      assert.ok(!factor.secret_ciphertext.includes(enrolled.secret));
      assert.equal((await sql`SELECT * FROM sessions WHERE user_id=${user.id}`).length, 1);
      await assertRestricted(initial);
      await assertRestricted(await seededSession(user));
      const status = ok(await request('/api/security/status', { cookie: enrolled.session }));
      assert.equal(status.data.totp.length, 1); assert.equal(status.data.recovery_codes_remaining, 10);
      for (const secret of [enrolled.secret, factor.secret_ciphertext, ...enrolled.data.recovery_codes]) assert.ok(!JSON.stringify(status.data).includes(secret));
      const pending = ok(await login(user)); assert.ok(pending.pending); assert.ok(!pending.session);
      assert.ok(pending.setCookies.some(value => /cardshelf_pending=.*HttpOnly/i.test(value) && /SameSite=Strict/i.test(value)));
      await assertRestricted(pending.pending);
      const pendingView = ok(await request('/api/session', { cookie: pending.pending }));
      assert.equal(pendingView.data.user, null); assert.equal(pendingView.data.pending.scope, 'mfa');
      denied(await post('/api/security/totp/begin', pending.pending, { password }));
      denied(await post('/api/security/totp/login', pending.pending, { code: enrolled.code }));
      const code = await generate({ secret: enrolled.secret, epoch: Math.floor(Date.now() / 1000) + 30 });
      const signedIn = ok(await post('/api/security/totp/login', pending.pending, { code }));
      assert.ok(signedIn.session); assert.ok(!signedIn.pending);
      assert.equal((await request('/api/session', { cookie: signedIn.session })).data.user.id, user.id);
      denied(await post('/api/security/totp/login', pending.pending, { code }));
      const another = ok(await login(user));
      denied(await post('/api/security/totp/login', another.pending, { code }));
      denied(await post('/api/security/totp/verify', enrolled.session, { challenge_token: enrolled.challenge, code }));
      const audit = JSON.stringify(await sql`SELECT detail FROM audit_log WHERE user_id=${user.id}`);
      for (const secret of [password, enrolled.secret, ...enrolled.data.recovery_codes]) assert.ok(!audit.includes(secret));
    });

    await t.test('passkeys verify real signatures and reject challenge, origin, RP, UV, signature and counter violations', async () => {
      const user = await account('passkey'), initial = ok(await login(user)).session, authenticator = softwareAuthenticator();
      const begin = ok(await post('/api/security/passkeys/begin', initial, { password }));
      assert.equal(begin.data.options.authenticatorSelection.userVerification, 'required');
      for (const overrides of [{ challenge: 'wrong-challenge' }, { origin: 'https://evil.test' }, { uv: false }]) {
        denied(await post('/api/security/passkeys/verify', initial, { challenge_token: begin.data.challenge_token,
          response: authenticator.registration(begin.data.options, origin, overrides) }));
      }
      const enrolled = ok(await post('/api/security/passkeys/verify', initial, { challenge_token: begin.data.challenge_token,
        response: authenticator.registration(begin.data.options, origin) }));
      assert.ok(enrolled.session); await assertRestricted(initial);
      const [stored] = await sql`SELECT * FROM account_passkeys WHERE user_id=${user.id}`;
      assert.deepEqual(stored.public_key, authenticator.publicKey); assert.equal(stored.credential_id, authenticator.id);
      for (const overrides of [{ challenge: 'wrong-challenge' }, { origin: 'https://evil.test' }, { rpId: 'evil.test' }, { uv: false }, { badSignature: true }]) {
        const pending = ok(await login(user)); assert.ok(pending.pending); assert.ok(!pending.session);
        const start = ok(await post('/api/security/passkeys/authenticate/begin', pending.pending, {}));
        assert.equal(start.data.options.userVerification, 'required');
        const invalid = await post('/api/security/passkeys/authenticate/verify', pending.pending, { challenge_token: start.data.challenge_token,
          response: authenticator.assertion(start.data.options, origin, overrides) });
        denied(invalid); assert.ok(!invalid.session);
      }
      const pending = ok(await login(user)), start = ok(await post('/api/security/passkeys/authenticate/begin', pending.pending, {}));
      const response = authenticator.assertion(start.data.options, origin, { counter: 1 });
      const valid = ok(await post('/api/security/passkeys/authenticate/verify', pending.pending, { challenge_token: start.data.challenge_token, response }));
      assert.ok(valid.session); assert.equal((await request('/api/session', { cookie: valid.session })).data.user.id, user.id);
      denied(await post('/api/security/passkeys/authenticate/verify', pending.pending, { challenge_token: start.data.challenge_token, response }));
      const replayPending = ok(await login(user)), replayStart = ok(await post('/api/security/passkeys/authenticate/begin', replayPending.pending, {}));
      denied(await post('/api/security/passkeys/authenticate/verify', replayPending.pending, { challenge_token: replayStart.data.challenge_token,
        response: authenticator.assertion(replayStart.data.options, origin, { counter: 1 }) }));
      const before = await seededSession(user, { strength: 'mfa' });
      assert.equal((await request('/api/session', { cookie: before })).data.user.id, user.id);
      await sql`UPDATE app_users SET security_version=security_version+1 WHERE id=${user.id}`;
      await assertRestricted(before);
      denied(await post('/api/security/passkeys/authenticate/begin', replayPending.pending, {}));
    });

    await t.test('one-use management proofs require current password and an existing factor; multiple factors remain usable', async () => {
      const user = await account('management'), enrolled = await enrollPasskey(user);
      const cookie = enrolled.session;
      denied(await post('/api/security/totp/begin', cookie, { password }));
      denied(await post('/api/security/recovery/regenerate', cookie, { password }));
      const proof = await passkeyProof(user, enrolled, cookie);
      const other = await seededSession(user, { strength: 'mfa' });
      denied(await post('/api/security/recovery/regenerate', other, { password, proof_token: proof }));
      denied(await post('/api/security/recovery/regenerate', cookie, { password: 'wrong', proof_token: proof }));
      const regenerated = ok(await post('/api/security/recovery/regenerate', cookie, { password, proof_token: proof }));
      assert.equal(regenerated.data.recovery_codes.length, 10);
      assert.ok(regenerated.data.recovery_codes.every(code => !enrolled.data.recovery_codes.includes(code)));
      denied(await post('/api/security/recovery/regenerate', cookie, { password, proof_token: proof }));
      const lastProof = await passkeyProof(user, enrolled, cookie);
      const [passkey] = await sql`SELECT id FROM account_passkeys WHERE user_id=${user.id}`;
      denied(await post('/api/security/factors/remove', cookie, { password, proof_token: lastProof, factor_id: passkey.id }));
      const added = await enrollTotp(user, cookie, { proof_token: lastProof });
      assert.equal((await sql`SELECT id FROM account_passkeys WHERE user_id=${user.id}`).length, 1);
      assert.equal((await sql`SELECT id FROM account_totp_credentials WHERE user_id=${user.id}`).length, 1);
      await assertRestricted(other); await assertRestricted(cookie);
      const removeProof = await passkeyProof(user, enrolled, added.session);
      const [totp] = await sql`SELECT id FROM account_totp_credentials WHERE user_id=${user.id}`;
      const removed = ok(await post('/api/security/factors/remove', added.session, { password, proof_token: removeProof, factor_id: totp.id }));
      assert.ok(removed.session); await assertRestricted(added.session);
      assert.equal((await sql`SELECT id FROM account_passkeys WHERE user_id=${user.id}`).length, 1);
      assert.equal((await sql`SELECT id FROM account_totp_credentials WHERE user_id=${user.id}`).length, 0);
    });

    await t.test('simultaneous recovery redemption succeeds once and grants enrollment-only scope until a replacement factor is verified', async () => {
      const user = await account('recovery'), enrolled = await enrollTotp(user);
      const oldFactors = await sql`SELECT id FROM account_totp_credentials WHERE user_id=${user.id}`;
      const a = ok(await login(user)), b = ok(await login(user)), code = enrolled.data.recovery_codes[0];
      denied(await post('/api/security/recovery/redeem', a.pending, { password: 'wrong', code }));
      const results = await Promise.all([a, b].map(pending => post('/api/security/recovery/redeem', pending.pending, { password, code })));
      assert.equal(results.filter(result => result.status === 200).length, 1);
      for (const result of results.filter(result => result.status !== 200)) denied(result);
      const recovered = results.find(result => result.status === 200);
      assert.ok(recovered.pending); assert.ok(!recovered.session);
      assert.equal(recovered.data.pending.scope, 'enrollment'); assert.equal(recovered.data.pending.recovery_mode, true);
      await assertRestricted(recovered.pending); await assertRestricted(enrolled.session);
      denied(await post('/api/security/totp/login', recovered.pending, { code: await generate({ secret: enrolled.secret }) }));
      denied(await post('/api/security/passkeys/authenticate/begin', recovered.pending, {}));
      const replacement = await enrollTotp(user, recovered.pending);
      const factors = await sql`SELECT id FROM account_totp_credentials WHERE user_id=${user.id}`;
      assert.equal(factors.length, 1); assert.ok(factors.every(factor => !oldFactors.some(old => old.id === factor.id)));
      assert.ok(replacement.data.recovery_codes.every(value => !enrolled.data.recovery_codes.includes(value)));
      assert.equal((await sql`SELECT mfa_reset_required FROM app_users WHERE id=${user.id}`)[0].mfa_reset_required, false);
      const next = ok(await login(user));
      denied(await post('/api/security/recovery/redeem', next.pending, { password, code }));
      assert.equal((await request('/api/session', { cookie: replacement.session })).data.user.id, user.id);
      denied(await post('/api/security/totp/login', next.pending, { code: await generate({ secret: enrolled.secret }) }));
    });

    await t.test('expired and exhausted pending sessions and enrollment challenges fail closed', async () => {
      const user = await account('attempts'), enrolled = await enrollPasskey(user);
      const expired = ok(await login(user));
      await sql`UPDATE account_pending_auth SET expires_at=now()-interval '1 second' WHERE token_hash=${digest(expired.cookies.cardshelf_pending)}`;
      assert.equal((await request('/api/session', { cookie: expired.pending })).data.pending, null);
      denied(await post('/api/security/passkeys/authenticate/begin', expired.pending, {}));
      const pending = ok(await login(user));
      for (let attempt = 0; attempt < 5; attempt++) denied(await post('/api/security/totp/login', pending.pending, { code: '123456' }));
      assert.equal((await sql`SELECT attempts FROM account_pending_auth WHERE token_hash=${digest(pending.cookies.cardshelf_pending)}`)[0].attempts, 5);
      const start = await post('/api/security/passkeys/authenticate/begin', pending.pending, {});
      if (start.status === 200) {
        // A challenge may be displayed at the limit, but no further factor
        // verification can redeem the exhausted pending attempt.
        denied(await post('/api/security/passkeys/authenticate/verify', pending.pending, { challenge_token: start.data.challenge_token,
          response: enrolled.authenticator.assertion(start.data.options, origin) }));
      } else denied(start);
      const fresh = await account('challenge-attempts'), initial = ok(await login(fresh)).session;
      const begun = ok(await post('/api/security/totp/begin', initial, { password }));
      await sql`UPDATE account_security_challenges SET expires_at=now()-interval '1 second' WHERE token_hash=${digest(begun.data.challenge_token)}`;
      denied(await post('/api/security/totp/verify', initial, { challenge_token: begun.data.challenge_token, code: await generate({ secret: begun.data.secret }) }));
      const active = ok(await post('/api/security/totp/begin', initial, { password }));
      for (let attempt = 0; attempt < 5; attempt++) denied(await post('/api/security/totp/verify', initial, { challenge_token: active.data.challenge_token, code: 'invalid' }));
      assert.equal((await sql`SELECT attempts FROM account_security_challenges WHERE token_hash=${digest(active.data.challenge_token)}`)[0].attempts, 5);
      denied(await post('/api/security/totp/verify', initial, { challenge_token: active.data.challenge_token, code: await generate({ secret: active.data.secret }) }));
      assert.equal((await sql`SELECT id FROM account_totp_credentials WHERE user_id=${fresh.id}`).length, 0);
    });

    await t.test('operator recovery grants remain password-bound, expiring and enrollment-only until a new factor is verified', async () => {
      const user = await account('operator-grant'), enrolled = await enrollPasskey(user);
      const [before] = await sql`SELECT password_hash,email_verified_at FROM app_users WHERE id=${user.id}`;
      const execute = () => recoverAdminMfa(sql, { email: user.email, execute: true, confirmEmail: user.email,
        confirmIdentity: true, reason: 'Synthetic incident verification' });
      const expiredGrant = await execute();
      await assertRestricted(enrolled.session);
      assert.equal((await sql`SELECT id FROM account_passkeys WHERE user_id=${user.id}`).length, 0);
      assert.equal((await sql`SELECT id FROM account_totp_credentials WHERE user_id=${user.id}`).length, 0);
      const first = ok(await login(user)); assert.ok(first.pending); assert.deepEqual(first.data.pending.methods, []);
      denied(await post('/api/security/totp/begin', first.pending, { password }));
      await sql`UPDATE account_recovery_codes SET expires_at=now()-interval '1 second' WHERE user_id=${user.id}`;
      denied(await post('/api/security/recovery/redeem', first.pending, { password, code: expiredGrant.code }));
      const grant = await execute(), second = ok(await login(user));
      denied(await post('/api/security/recovery/redeem', second.pending, { password: 'incorrect', code: grant.code }));
      const recovery = ok(await post('/api/security/recovery/redeem', second.pending, { password, code: grant.code }));
      assert.ok(recovery.pending); assert.ok(!recovery.session); assert.equal(recovery.data.pending.scope, 'enrollment');
      await assertRestricted(recovery.pending);
      denied(await post('/api/security/recovery/redeem', second.pending, { password, code: grant.code }));
      const replacement = await enrollTotp(user, recovery.pending);
      assert.equal((await request('/api/admin/users', { cookie: replacement.session })).status, 200);
      const [after] = await sql`SELECT password_hash,email_verified_at,mfa_reset_required FROM app_users WHERE id=${user.id}`;
      assert.equal(after.password_hash, before.password_hash); assert.equal(+after.email_verified_at, +before.email_verified_at);
      assert.equal(after.mfa_reset_required, false);
      assert.equal((await sql`SELECT id FROM account_passkeys WHERE user_id=${user.id}`).length, 0);
      const next = ok(await login(user));
      denied(await post('/api/security/recovery/redeem', next.pending, { password, code: grant.code }));
      const audit = JSON.stringify(await sql`SELECT detail FROM audit_log WHERE user_id=${user.id}`);
      assert.ok(!audit.includes(grant.code)); assert.ok(!audit.includes(expiredGrant.code));
    });

    await t.test('expired management proofs and stale MFA cannot authorize sensitive changes; reauthentication refreshes them', async () => {
      const user = await account('fresh-proof'), enrolled = await enrollPasskey(user), cookie = enrolled.session;
      const proof = await passkeyProof(user, enrolled, cookie);
      await sql`UPDATE account_security_proofs SET expires_at=now()-interval '1 second' WHERE token_hash=${digest(proof)}`;
      denied(await post('/api/security/recovery/regenerate', cookie, { password, proof_token: proof }));
      await sql`UPDATE sessions SET strong_authenticated_at=now()-interval '10 minutes' WHERE token_hash=${digest(enrolled.cookies.cardshelf_session)}`;
      assert.equal((await request('/api/session', { cookie })).data.user.id, user.id);
      const stale = await post('/api/password', cookie, { current_password: password, password: nextPassword });
      assert.equal(stale.status, 403);
      const before = (await sql`SELECT password_hash FROM app_users WHERE id=${user.id}`)[0].password_hash;
      denied(await post('/api/security/passkeys/authenticate/begin', cookie, { purpose: 'reauth', password: 'incorrect' }));
      await passkeyProof(user, enrolled, cookie);
      const changed = ok(await post('/api/password', cookie, { current_password: password, password: nextPassword }));
      user.password = nextPassword; assert.ok(changed.session);
      assert.notEqual((await sql`SELECT password_hash FROM app_users WHERE id=${user.id}`)[0].password_hash, before);
    });

    await t.test('password changes and password reset revoke pending logins without downgrading enrolled MFA', async () => {
      const user = await account('password'), enrolled = await enrollPasskey(user);
      const pending = ok(await login(user));
      const [before] = await sql`SELECT security_version,password_hash FROM app_users WHERE id=${user.id}`;
      const reset = randomToken();
      await sql`INSERT INTO password_recovery_tokens(token_hash,user_id,password_fingerprint,expires_at)
        VALUES(${digest(reset)},${user.id},${digest(before.password_hash)},now()+interval '1 hour')`;
      const changed = ok(await post('/api/password', enrolled.session, { current_password: password, password: nextPassword }));
      user.password = nextPassword;
      await assertRestricted(enrolled.session);
      denied(await post('/api/security/passkeys/authenticate/begin', pending.pending, {}));
      assert.equal((await sql`SELECT * FROM password_recovery_tokens WHERE user_id=${user.id}`).length, 0);
      assert.equal((await sql`SELECT * FROM account_passkeys WHERE user_id=${user.id}`).length, 1);
      const next = ok(await login(user)); assert.ok(next.pending); assert.ok(!next.session);
      const [current] = await sql`SELECT security_version,password_hash FROM app_users WHERE id=${user.id}`;
      assert.ok(Number(current.security_version) > Number(before.security_version));
      const token = randomToken();
      await sql`INSERT INTO password_recovery_tokens(token_hash,user_id,password_fingerprint,expires_at)
        VALUES(${digest(token)},${user.id},${digest(current.password_hash)},now()+interval '1 hour')`;
      const resetResult = ok(await post('/api/public/password-recovery/complete', undefined, { token, password, confirm_password: password }));
      assert.ok(!resetResult.session); assert.ok(!resetResult.pending); user.password = password;
      if (changed.session) await assertRestricted(changed.session);
      denied(await post('/api/security/passkeys/authenticate/begin', next.pending, {}));
      const after = ok(await login(user)); assert.ok(after.pending); assert.ok(!after.session);
      assert.equal((await sql`SELECT * FROM account_passkeys WHERE user_id=${user.id}`).length, 1);
      assert.ok(Number((await sql`SELECT security_version FROM app_users WHERE id=${user.id}`)[0].security_version) > Number(current.security_version));
    });
  } finally {
    // Delete only fixtures belonging to this run. No global truncation, queue
    // processing, or mutations to installation-level billing/email settings.
    for (const user of accounts) {
      await sql`DELETE FROM password_recovery_mail WHERE lower(email)=${user.email}`;
      await sql`DELETE FROM email_verification_mail WHERE lower(email)=${user.email}`;
      await sql`DELETE FROM audit_log WHERE user_id=${user.id}`;
      await sql`DELETE FROM app_users WHERE id=${user.id}`;
    }
    if (rateBuckets.size) await sql`DELETE FROM auth_attempts WHERE bucket IN ${sql([...rateBuckets])}`;
    await sql`DELETE FROM auth_attempts WHERE bucket IN ${sql(loopbackBuckets)}`;
    if (savedIpAttempts.length) await sql`INSERT INTO auth_attempts ${sql(savedIpAttempts, 'bucket', 'attempts', 'reset_at')}`;
    await sql.end(); await closeDatabase();
  }
});

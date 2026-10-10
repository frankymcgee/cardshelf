// Synthetic, isolated authentication races. SQL row locks provide deterministic
// barriers; no timing-dependent sleeps decide which operation wins the lock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';
import { generate } from 'otplib';
import { db, closeDatabase } from '../../lib/db.mjs';
import { login, logout, sessionUser, changePassword } from '../../lib/auth.mjs';
import { verifyTotpLogin, createAccountSession, redeemRecoveryCode, beginTotpEnrollment, verifyTotpEnrollment,
  beginPasskeyAuthentication, verifyPasskeyAuthentication, removeFactor, reauthenticate } from '../../lib/account-security.mjs';
import { newTotp, encryptTotp, newRecoveryCodes, recoveryCodeHash } from '../../lib/account-security-logic.mjs';
import { hashPassword, digest } from '../../lib/security.mjs';
import { softwareAuthenticator } from '../helpers/account-security-fixtures.mjs';

const databaseUrl = process.env.DATABASE_URL;
if (process.env.ALLOW_TEST_DATABASE !== 'yes' || !new URL(databaseUrl || 'http://invalid').pathname.endsWith('_test') || process.env.RECOVERY_EMAIL_ENABLED === 'true') {
  throw new Error('Use an explicitly disposable _test database and disable real recovery email.');
}
const sql = postgres(databaseUrl, { max: 3, connection: { application_name: 'cardshelf-security-races', statement_timeout: 15000 } });
const password = 'Synthetic account race password 123!', replacementPassword = 'Synthetic replacement race password 456!';
const fixtures = [], tokens = new Set();
const track = result => { if (result.token) tokens.add(result.token); if (result.pending_token) tokens.add(result.pending_token); return result; };
async function fixture({ passkey = false, enrolled = true } = {}) {
  const user = { id: randomUUID(), password, ip: 'security-race-' + randomUUID(), factorId: randomUUID() };
  user.email = `security-race-${user.id}@example.test`; fixtures.push(user);
  await sql`INSERT INTO app_users(id,email,name,password_hash,role,email_verification_required)
    VALUES(${user.id},${user.email},'Synthetic security race',${await hashPassword(password)},'user',false)`;
  if (passkey) {
    user.authenticator = softwareAuthenticator(); user.counter = 0;
    await sql`INSERT INTO account_passkeys(id,user_id,credential_id,public_key,counter,device_type,backed_up,label)
      VALUES(${user.factorId},${user.id},${user.authenticator.id},${Buffer.from(user.authenticator.publicKey)},0,'singleDevice',false,'Synthetic passkey')`;
  } else if (enrolled) {
    user.totp = newTotp(user.email);
    await sql`INSERT INTO account_totp_credentials(id,user_id,label,secret_ciphertext)
      VALUES(${user.factorId},${user.id},'Synthetic authenticator',${encryptTotp(user.totp.secret,user.id,user.factorId)})`;
  }
  return user;
}
async function signIn(user) { return track(await login({ email: user.email, password: user.password }, user.ip)); }
async function holdRow(table, column, value) {
  let release, ready;
  const gate = new Promise(resolve => { release = resolve; });
  const held = new Promise(resolve => { ready = resolve; });
  const task = sql.begin(async tx => {
    const [row] = await tx`SELECT pg_backend_pid() AS pid`;
    await tx`SELECT ${tx(column)} FROM ${tx(table)} WHERE ${tx(column)}=${value} FOR UPDATE`;
    ready(row.pid); await gate;
  });
  task.catch(error => ready(Promise.reject(error)));
  const pid = await held;
  return { pid, release, task };
}
async function blocked(fragment, blocker = null) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [row] = await sql`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
      WHERE application_name='cardshelf' AND wait_event_type='Lock' AND position(${fragment} in query)>0
        AND (${blocker === null} OR ${blocker}::integer=ANY(pg_blocking_pids(pid)))) AS blocked`;
    if (row.blocked) return;
    await delay(50);
  }
  assert.fail('Operation did not reach its deterministic SQL lock barrier: ' + fragment);
}
const outcome = promise => promise.then(result => ({ result: track(result) }), error => ({ error }));
async function existingSession(user) {
  const token = await db().begin(async tx => {
    const [record] = await tx`SELECT * FROM app_users WHERE id=${user.id} FOR UPDATE`;
    return createAccountSession(tx, record, 'mfa', new Date());
  });
  tokens.add(token); return token;
}
async function recovery(user, pending) {
  const code = newRecoveryCodes()[0];
  await sql`INSERT INTO account_recovery_codes(code_hash,user_id) VALUES(${recoveryCodeHash(user.id,code)},${user.id})`;
  return track(await redeemRecoveryCode(pending.pending_token, { password: user.password, code }, user.ip));
}
async function finishEnrollment(user, pending) {
  const begin = await beginTotpEnrollment({ pendingToken: pending.pending_token }, { password: user.password }, user.ip);
  return track(await verifyTotpEnrollment({ pendingToken: pending.pending_token }, {
    challenge_token: begin.challenge_token, code: await generate({ secret: begin.secret }),
  }, user.ip));
}
async function passkeyCheck(user, token, purpose) {
  const context = purpose === 'login' ? { pendingToken: token } : { sessionToken: token };
  const begin = await beginPasskeyAuthentication(context, { purpose, password: user.password }, user.ip);
  return track(await verifyPasskeyAuthentication(context, { purpose, challenge_token: begin.challenge_token,
    response: user.authenticator.assertion(begin.options, process.env.APP_ORIGIN, { counter: ++user.counter }),
  }, user.ip));
}

await test('pending sign-in cancellation revokes only its bounded authentication lineage', async t => {
  try {
    await t.test('cancellation wins the account lock and prevents TOTP completion', async () => {
      const user = await fixture(), pending = await signIn(user), gate = await holdRow('app_users', 'id', user.id);
      let cancelling, verifying;
      try {
        cancelling = logout(undefined, pending.pending_token);
        await blocked('SELECT id FROM app_users', gate.pid);
        verifying = outcome(verifyTotpLogin(pending.pending_token, { code: await generate({ secret: user.totp.secret }) }, user.ip));
        await blocked('SELECT * FROM app_users');
      } finally { gate.release(); await gate.task; }
      await cancelling; const result = await verifying;
      assert.equal(result.error?.status, 401); assert.ok(!result.result?.token);
      assert.equal((await sql`SELECT token_hash FROM sessions WHERE user_id=${user.id}`).length, 0);
    });

    await t.test('completion wins the account lock, but waiting cancellation revokes its new session and preserves unrelated sessions', async () => {
      const user = await fixture(), unrelated = await existingSession(user), pending = await signIn(user);
      const gate = await holdRow('account_totp_credentials', 'id', user.factorId); let verifying, cancelling;
      try {
        verifying = outcome(verifyTotpLogin(pending.pending_token, { code: await generate({ secret: user.totp.secret }) }, user.ip));
        await blocked('account_totp_credentials', gate.pid);
        cancelling = logout(undefined, pending.pending_token);
        await blocked('SELECT id FROM app_users');
      } finally { gate.release(); await gate.task; }
      const completed = await verifying; await cancelling;
      assert.ok(completed.result?.token, completed.error?.message);
      assert.equal(await sessionUser(completed.result.token), null);
      assert.equal((await sessionUser(unrelated)).id, user.id);
      assert.equal((await sql`SELECT token_hash FROM account_pending_auth WHERE user_id=${user.id}`).length, 0);
    });

    await t.test('cancellation waiting on recovery revokes the newly rotated enrollment token', async () => {
      const user = await fixture(), pending = await signIn(user), code = newRecoveryCodes()[0], hash = recoveryCodeHash(user.id, code);
      await sql`INSERT INTO account_recovery_codes(code_hash,user_id) VALUES(${hash},${user.id})`;
      const gate = await holdRow('account_recovery_codes', 'code_hash', hash); let redeeming, cancelling;
      try {
        redeeming = outcome(redeemRecoveryCode(pending.pending_token, { password, code }, user.ip));
        await blocked('UPDATE account_recovery_codes', gate.pid);
        cancelling = logout(undefined, pending.pending_token);
        await blocked('SELECT id FROM app_users');
      } finally { gate.release(); await gate.task; }
      const redeemed = await redeeming; await cancelling;
      assert.ok(redeemed.result?.pending_token, redeemed.error?.message);
      assert.equal((await sql`SELECT token_hash FROM account_pending_auth WHERE user_id=${user.id}`).length, 0);
      await assert.rejects(beginTotpEnrollment({ pendingToken: redeemed.result.pending_token }, { password }, user.ip), error => error.status === 401);
    });

    for (const cancelWith of ['ancestor', 'current']) {
      await t.test(`${cancelWith} pending cookie cancels recovery enrollment and cannot extend its original expiry`, async () => {
        const user = await fixture(), pending = await signIn(user);
        const [original] = await sql`SELECT expires_at FROM account_pending_auth WHERE token_hash=${digest(pending.pending_token)}`;
        const recovered = await recovery(user, pending);
        const [child] = await sql`SELECT pending_auth_hashes,expires_at FROM account_pending_auth WHERE token_hash=${digest(recovered.pending_token)}`;
        assert.deepEqual(child.pending_auth_hashes, [digest(pending.pending_token), digest(recovered.pending_token)]);
        assert.equal(+child.expires_at, +original.expires_at);
        await logout(undefined, cancelWith === 'ancestor' ? pending.pending_token : recovered.pending_token);
        assert.equal((await sql`SELECT token_hash FROM account_pending_auth WHERE user_id=${user.id}`).length, 0);
      });
      await t.test(`${cancelWith} pending cookie also cancels a completed replacement enrollment`, async () => {
        const user = await fixture(), pending = await signIn(user), recovered = await recovery(user, pending);
        const completed = await finishEnrollment(user, recovered);
        assert.equal((await sessionUser(completed.token)).id, user.id);
        await logout(undefined, cancelWith === 'ancestor' ? pending.pending_token : recovered.pending_token);
        assert.equal(await sessionUser(completed.token), null);
      });
    }

    await t.test('password and factor rotations preserve the original pending cancellation boundary', async () => {
      const user = await fixture({ passkey: true }), pending = await signIn(user);
      const initial = await passkeyCheck(user, pending.pending_token, 'login');
      let session = await changePassword(user.id, { current_password: password, password: replacementPassword }, initial.token);
      tokens.add(session); user.password = replacementPassword;
      const proof = await passkeyCheck(user, session, 'reauth');
      const begin = await beginTotpEnrollment({ sessionToken: session }, { password: user.password, proof_token: proof.proof_token }, user.ip);
      const added = track(await verifyTotpEnrollment({ sessionToken: session }, { challenge_token: begin.challenge_token, code: await generate({ secret: begin.secret }) }, user.ip));
      const [totp] = await sql`SELECT id FROM account_totp_credentials WHERE user_id=${user.id}`;
      const removalProof = await passkeyCheck(user, added.token, 'reauth');
      const removed = track(await removeFactor({ sessionToken: added.token }, { password: user.password, proof_token: removalProof.proof_token, factor_id: totp.id }, user.ip));
      const [final] = await sql`SELECT pending_auth_hashes,pending_auth_expires_at FROM sessions WHERE token_hash=${digest(removed.token)}`;
      assert.deepEqual(final.pending_auth_hashes, [digest(pending.pending_token)]);
      assert.equal(+final.pending_auth_expires_at, +new Date(pending.pending.expires_at));
      await logout(undefined, pending.pending_token); assert.equal(await sessionUser(removed.token), null);
    });

    await t.test('expired pending ancestry cannot cancel a current session; direct logout still works', async () => {
      const user = await fixture(), pending = await signIn(user);
      const completed = track(await verifyTotpLogin(pending.pending_token, { code: await generate({ secret: user.totp.secret }) }, user.ip));
      await sql`UPDATE sessions SET pending_auth_expires_at=now()-interval '1 second' WHERE token_hash=${digest(completed.token)}`;
      await logout(undefined, pending.pending_token);
      assert.equal((await sessionUser(completed.token)).id, user.id);
      await logout(completed.token); assert.equal(await sessionUser(completed.token), null);
    });

    await t.test('password-only sessions have no pending cancellation provenance', async () => {
      const user = await fixture({ enrolled: false }), signedIn = await signIn(user);
      const [record] = await sql`SELECT pending_auth_hashes,pending_auth_expires_at FROM sessions WHERE token_hash=${digest(signedIn.token)}`;
      assert.deepEqual(record.pending_auth_hashes, []); assert.equal(record.pending_auth_expires_at, null);
      await logout(undefined, signedIn.token); assert.equal((await sessionUser(signedIn.token)).id, user.id);
    });

    await t.test('an unrelated or malformed pending cookie cannot divert a session account retry budget', async () => {
      const target = await fixture(), other = await fixture(), session = await existingSession(target), pending = await signIn(other);
      const proof = { password, code: 'invalid' };
      await assert.rejects(reauthenticate({ sessionToken: session, pendingToken: pending.pending_token }, proof, target.ip), error => error.status === 403);
      const attempts = async user => (await sql`SELECT attempts FROM auth_attempts WHERE bucket=${digest('security-user:' + user.id)}`)[0]?.attempts;
      assert.equal(await attempts(target), 1); assert.equal(await attempts(other), 1);
      await assert.rejects(reauthenticate({ sessionToken: session, pendingToken: 'malformed' }, proof, target.ip), error => error.status === 403);
      assert.equal(await attempts(target), 2); assert.equal(await attempts(other), 1);
      await sql`UPDATE auth_attempts SET attempts=50,reset_at=now()+interval '15 minutes' WHERE bucket=${digest('security-user:' + target.id)}`;
      await assert.rejects(reauthenticate({ sessionToken: session, pendingToken: pending.pending_token }, proof, target.ip), error => error.status === 429);
    });
  } finally {
    for (const user of fixtures) {
      await sql`DELETE FROM email_outbox WHERE user_id=${user.id}`;
      await sql`DELETE FROM audit_log WHERE user_id=${user.id}`;
      await sql`DELETE FROM app_users WHERE id=${user.id}`;
    }
    const buckets = [...fixtures.flatMap(user => ['login-ip:' + user.ip, 'login-email:' + user.email, 'security-ip:' + user.ip,
      'security-user:' + user.id, 'password-change:' + user.id]), ...[...tokens].map(token => 'security-context:' + digest(token))].map(digest);
    if (buckets.length) await sql`DELETE FROM auth_attempts WHERE bucket IN ${sql(buckets)}`;
    await sql.end(); await closeDatabase();
  }
});

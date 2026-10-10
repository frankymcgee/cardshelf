import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseRecoveryArgs, recoverAdminMfa, main, RECOVERY_GRANT_MINUTES } from '../scripts/recover-admin-mfa.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const email = 'operator@example.test';
const identity = { id: '00000000-0000-0000-0000-000000000001', email, role: 'admin', mfa_reset_required: false, security_version: '7' };
const execution = { email, execute: true, confirmEmail: email, confirmIdentity: true, reason: 'INC-2026-10010 verified in person' };
const hash = text => createHash('sha256').update(text).digest('hex');

function mockDatabase({ user = identity, lockedUser = user, reject = '' } = {}) {
  const calls = [];
  let inTransaction = false, committed = false, rolledBack = false;
  const sql = async (parts, ...values) => {
    const query = parts.join('?').replace(/\s+/g, ' ').trim();
    calls.push({ query, values, inTransaction });
    if (reject && query.includes(reject)) throw Error('Database error containing confidential parameters');
    if (query.startsWith('SELECT id,email')) return (query.includes('FOR UPDATE') ? lockedUser : user) ? [query.includes('FOR UPDATE') ? lockedUser : user] : [];
    if (query.startsWith('SELECT (SELECT count')) return [{ totp: 1, passkeys: 2, sessions: 3, recovery_codes: 4 }];
    if (query.startsWith('INSERT INTO account_recovery_codes')) return [{ expires_at: new Date('2030-01-01T00:30:00Z') }];
    return [];
  };
  sql.json = detail => detail;
  sql.begin = async fn => { inTransaction = true; try { const result = await fn(sql); committed = true; return result; } catch (error) { rolledBack = true; throw error; } finally { inTransaction = false; } };
  return { sql, calls, get committed() { return committed; }, get rolledBack() { return rolledBack; } };
}

test('recovery CLI defaults to exact-address read-only inspection', async () => {
  assert.deepEqual(parseRecoveryArgs(['--email', '  Operator@Example.Test  ']), { email, execute: false, dryRun: false, confirmIdentity: false, restoredAccount: false });
  const db = mockDatabase();
  const result = await recoverAdminMfa(db.sql, { email });
  assert.deepEqual(result, { executed: false, email, role: 'admin', resetRequired: false, totp: 1, passkeys: 2, sessions: 3, recovery_codes: 4 });
  assert.ok(db.calls.every(call => call.query.startsWith('SELECT ') && !call.inTransaction));
  assert.equal(db.committed, false);
  assert.equal('code' in result, false);
});

test('execution requires exact target confirmation, identity verification and bounded incident reason', () => {
  const prefix = ['--email', email, '--execute'];
  assert.throws(() => parseRecoveryArgs(prefix), /confirm-identity/);
  assert.throws(() => parseRecoveryArgs([...prefix, '--confirm-identity']), /confirm-email/);
  assert.throws(() => parseRecoveryArgs([...prefix, '--confirm-identity', '--confirm-email', 'different@example.test', '--reason', 'INC-12345']), /confirm-email/);
  assert.throws(() => parseRecoveryArgs([...prefix, '--confirm-identity', '--confirm-email', email]), /reason/);
  for (const reason of ['short', 'x'.repeat(301), 'Incident\nwith control']) assert.throws(() => parseRecoveryArgs([...prefix, '--confirm-identity', '--confirm-email', email, '--reason', reason]), /reason/);
  assert.throws(() => parseRecoveryArgs([...prefix, '--dry-run']), /cannot be combined/);
  assert.throws(() => parseRecoveryArgs(['--email', email, '--email', email]), /Repeated option/);
  assert.throws(() => parseRecoveryArgs(['--email', email, '--yes']), /Unknown option/);
  assert.throws(() => parseRecoveryArgs(['--email', '%@example.test;DELETE FROM users']), /exact account email/);
});

test('CLI help does not need or connect to a database', async () => {
  const output = [];
  assert.equal(await main(['--help'], { stdout: value => output.push(value), stderr: () => assert.fail('Unexpected error') }), 0);
  assert.match(output.join('\n'), /Read-only inspection is the default/);
  assert.match(output.join('\n'), /existing password is still/);
});

test('unknown accounts and normal non-admin accounts cannot be reset', async () => {
  for (const user of [null, { ...identity, role: 'user' }]) {
    const db = mockDatabase({ user });
    await assert.rejects(recoverAdminMfa(db.sql, execution));
    assert.ok(db.calls.every(call => call.query.startsWith('SELECT ')));
    assert.equal(db.committed, false);
  }
  const db = mockDatabase({ user: { ...identity, role: 'user', mfa_reset_required: true } });
  await assert.rejects(recoverAdminMfa(db.sql, execution), /restored-account/);
  const result = await recoverAdminMfa(db.sql, { email, restoredAccount: true });
  assert.equal(result.executed, false);
});

test('recovery locks and rechecks the target, revokes credentials atomically and stores only a short-lived code hash', async () => {
  const db = mockDatabase();
  const result = await recoverAdminMfa(db.sql, execution);
  assert.equal(result.executed, true);
  assert.equal(db.committed, true);
  assert.match(result.code, /^(?:[0-9A-F]{4}-){7}[0-9A-F]{4}$/);
  assert.equal(RECOVERY_GRANT_MINUTES, 30);
  const mutation = db.calls.filter(call => /^(DELETE|UPDATE|INSERT) /.test(call.query));
  assert.ok(mutation.length > 8);
  assert.ok(mutation.every(call => call.inTransaction));
  assert.match(db.calls[1].query, /app_users .* FOR UPDATE$/);
  for (const table of ['sessions', 'account_pending_auth', 'account_security_challenges', 'account_security_proofs', 'account_recovery_codes', 'account_totp_credentials', 'account_passkeys', 'password_recovery_tokens', 'email_verification_tokens', 'email_verification_mail']) {
    assert.ok(mutation.some(call => call.query.startsWith(`DELETE FROM ${table} WHERE user_id=`) && call.values[0] === identity.id), table);
  }
  const update = mutation.find(call => call.query.startsWith('UPDATE app_users'));
  assert.match(update.query, /security_version=security_version\+1,mfa_reset_required=true/);
  assert.doesNotMatch(mutation.map(call => call.query).join('\n'), /password_hash\s*=/);
  const grant = mutation.find(call => call.query.startsWith('INSERT INTO account_recovery_codes'));
  assert.equal(grant.values[0], hash('cardshelf-recovery:' + identity.id + ':' + result.code.replaceAll('-', '')));
  assert.match(grant.query, /now\(\)\+interval '30 minutes'/);
  const audit = mutation.find(call => call.query.startsWith('INSERT INTO audit_log'));
  assert.equal(audit.values[1].reason_sha256, hash(execution.reason));
  assert.equal(audit.values[1].operator_identity_verified, true);
  assert.doesNotMatch(JSON.stringify(db.calls), new RegExp(result.code));
  assert.ok(!JSON.stringify(db.calls).includes(execution.reason));
});

test('explicit restored-user recovery has the same enrollment-only grant requirements', async () => {
  const db = mockDatabase({ user: { ...identity, role: 'user', mfa_reset_required: true } });
  const result = await recoverAdminMfa(db.sql, { ...execution, restoredAccount: true });
  assert.equal(result.executed, true);
  assert.equal(result.role, 'user');
  const ordinary = mockDatabase({ user: { ...identity, role: 'user' } });
  await assert.rejects(recoverAdminMfa(ordinary.sql, { ...execution, restoredAccount: true }), /not an administrator/);
});

test('a changed account or a failed write rolls back without returning a recovery code', async () => {
  for (const db of [mockDatabase({ lockedUser: { ...identity, email: 'changed@example.test' } }), mockDatabase({ reject: 'INSERT INTO audit_log' })]) {
    await assert.rejects(recoverAdminMfa(db.sql, execution));
    assert.equal(db.committed, false);
    assert.equal(db.rolledBack, true);
  }
});

function restoreFixture(run, failure = '') {
  const dir = mkdtempSync(join(tmpdir(), 'cardshelf-security-restore-'));
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(join(root, 'scripts/restore.sh'), join(dir, 'scripts/restore.sh'));
  writeFileSync(join(dir, 'backup.dump'), 'synthetic archive');
  writeFileSync(join(dir, 'scripts/backup.sh'), '#!/bin/sh\nprintf "backup\\n" >> calls\n');
  writeFileSync(join(dir, 'scripts/compose.sh'), `#!/bin/sh
printf '%s\\n' "$*" >> calls
case "$*" in
  *psql*) cat > restore.sql;;
esac
case "$*" in
  *'${failure || '__never__'}'*) exit 17;;
esac
`);
  try {
    const result = spawnSync('sh', ['scripts/restore.sh', 'backup.dump', '--confirm-restore'], { cwd: dir, encoding: 'utf8', timeout: 5000 });
    run({ result, calls: readFileSync(join(dir, 'calls'), 'utf8'), sql: (() => { try { return readFileSync(join(dir, 'restore.sql'), 'utf8'); } catch { return ''; } })() });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('restore migrates then invalidates all authentication artifacts before restart', () => restoreFixture(({ result, calls, sql }) => {
  assert.equal(result.status, 0, result.stderr);
  assert.ok(calls.indexOf('stop app worker') < calls.indexOf('backup\n'));
  assert.ok(calls.indexOf('run --rm migrate') < calls.indexOf('psql'));
  assert.ok(calls.indexOf('psql') < calls.indexOf('up -d app worker'));
  for (const table of ['sessions', 'account_pending_auth', 'account_security_challenges', 'account_security_proofs', 'account_recovery_codes', 'account_totp_credentials', 'account_passkeys', 'password_recovery_tokens', 'email_verification_tokens', 'email_verification_mail']) assert.match(sql, new RegExp(`DELETE FROM ${table};`));
  assert.match(sql, /security_version=security_version\+1/);
  assert.match(sql, /mfa_reset_required=\(role='admin' OR mfa_reset_required/);
  for (const table of ['account_totp_credentials', 'account_passkeys', 'account_recovery_codes']) assert.ok(sql.includes(`OR EXISTS (SELECT 1 FROM ${table} WHERE user_id=app_users.id)`));
  assert.ok(sql.indexOf('UPDATE app_users') < sql.indexOf('DELETE FROM account_totp_credentials'));
  assert.match(sql, /'restored_mfa_quarantined'/);
  assert.doesNotMatch(sql, /SET\s+(?:password_hash|email_verified_at|role)\s*=/i);
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(result.stdout, /require verified server-operator recovery and fresh enrollment/);
}));

test('failed restore migrations or security cleanup never restart app or worker', () => {
  for (const failure of ['run --rm migrate', 'psql']) restoreFixture(({ result, calls }) => {
    assert.notEqual(result.status, 0);
    assert.ok(!calls.includes('up -d app worker'));
    assert.match(result.stderr, /remain stopped/);
  }, failure);
});

// CI runs ordinary unit tests before migrations with disposable-DB variables
// already present. Only the post-migration integration wrapper or an explicit
// operator test invocation may opt into database work.
const testDatabase = process.env.CARDSHELF_SECURITY_DB_TESTS === 'yes' && process.env.ALLOW_TEST_DATABASE === 'yes' && (() => { try { return new URL(process.env.DATABASE_URL).pathname.endsWith('_test'); } catch { return false; } })();
test('disposable PostgreSQL recovery preserves password and verification while replacing every credential with one grant', { skip: !testDatabase }, async () => {
  const { default: postgres } = await import('postgres');
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  const id = randomUUID(), target = `operator-recovery-${id}@example.test`, passwordHash = 'synthetic password fingerprint';
  try {
    await sql`INSERT INTO app_users (id,email,name,password_hash,role,email_verified_at) VALUES (${id},${target},'Synthetic recovery admin',${passwordHash},'admin',now())`;
    await sql`INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (${hash('session'+id)},${id},now()+interval '1 hour')`;
    await sql`INSERT INTO account_totp_credentials (user_id,label,secret_ciphertext) VALUES (${id},'Synthetic','not-a-live-secret')`;
    await sql`INSERT INTO account_recovery_codes (code_hash,user_id) VALUES (${hash('old-code'+id)},${id})`;
    await sql`INSERT INTO account_pending_auth (token_hash,user_id,security_version,scope,expires_at) VALUES (${hash('pending'+id)},${id},0,'mfa',now()+interval '1 hour')`;
    await sql`INSERT INTO account_security_challenges (token_hash,user_id,context_hash,security_version,kind,expires_at) VALUES (${hash('challenge'+id)},${id},${hash('context')},0,'totp-enroll',now()+interval '1 hour')`;
    const result = await recoverAdminMfa(sql, { ...execution, email: target, confirmEmail: target });
    assert.equal(result.executed, true);
    const [user] = await sql`SELECT * FROM app_users WHERE id=${id}`;
    assert.equal(user.password_hash, passwordHash);
    assert.ok(user.email_verified_at);
    assert.equal(user.mfa_reset_required, true);
    assert.equal(String(user.security_version), '1');
    for (const table of ['sessions', 'account_pending_auth', 'account_security_challenges', 'account_totp_credentials']) assert.equal((await sql`SELECT count(*)::int AS count FROM ${sql(table)} WHERE user_id=${id}`)[0].count, 0);
    const codes = await sql`SELECT * FROM account_recovery_codes WHERE user_id=${id}`;
    assert.equal(codes.length, 1);
    assert.equal(codes[0].used_at, null);
    assert.equal(codes[0].code_hash, hash('cardshelf-recovery:' + id + ':' + result.code.replaceAll('-', '')));
    const age = new Date(codes[0].expires_at) - Date.now();
    assert.ok(age > 29*60*1000 && age <= 30*60*1000);
  } finally { await sql`DELETE FROM app_users WHERE id=${id}`; await sql.end(); }
});

test('disposable PostgreSQL restore cleanup quarantines enrolled users and invalidates every restored bearer artifact', { skip: !testDatabase }, async () => {
  const { default: postgres } = await import('postgres');
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  const artifactTables = ['sessions', 'account_pending_auth', 'account_security_challenges', 'account_security_proofs', 'account_recovery_codes', 'account_totp_credentials', 'account_passkeys', 'password_recovery_tokens', 'email_verification_tokens', 'email_verification_mail'];
  const source = readFileSync(join(root, 'scripts/restore.sh'), 'utf8');
  const cleanup = source.split("<<'SQL'\n")[1].split('\nSQL')[0].replace(/^BEGIN;\n/, '').replace(/\nCOMMIT;\s*$/, '');
  try {
    await sql.begin(async tx => {
      // Every cleanup target is shadowed by a temporary table: no real account,
      // worker or provider state in even the disposable database can be touched.
      await tx`SET LOCAL search_path=pg_temp,public`;
      for (const table of ['app_users', 'audit_log', ...artifactTables, 'jobs', 'password_recovery_mail', 'email_outbox', 'email_settings']) {
        await tx`CREATE TEMP TABLE ${tx(table)} (LIKE public.${tx(table)} INCLUDING ALL) ON COMMIT DROP`;
      }
      // Final account is an administrator from a backup that predates MFA:
      // there are no factors or flags in the archive to reveal later enrollment.
      const users = Array.from({ length: 6 }, () => randomUUID());
      for (const [i, id] of users.entries()) await tx`INSERT INTO app_users (id,email,name,password_hash,role,security_version,mfa_reset_required,email_verified_at)
        VALUES (${id},${'restore-'+i+'@example.test'},'Synthetic restore','unchanged-password',${i===5?'admin':'user'},7,${i===3},'2026-01-01T00:00:00Z')`;
      await tx`INSERT INTO account_totp_credentials (user_id,label,secret_ciphertext) VALUES (${users[0]},'Old authenticator','synthetic-ciphertext')`;
      await tx`INSERT INTO account_passkeys (user_id,credential_id,public_key,device_type,label)
        VALUES (${users[1]},'synthetic-credential',${Buffer.from('synthetic-public-key')},'singleDevice','Old passkey')`;
      await tx`INSERT INTO account_recovery_codes (code_hash,user_id,expires_at) VALUES (${hash('restored-operator-grant')},${users[2]},now()+interval '30 minutes')`;
      await tx`INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (${hash('restored-session')},${users[0]},now()+interval '1 hour')`;
      await tx`INSERT INTO account_pending_auth (token_hash,user_id,security_version,scope,expires_at)
        VALUES (${hash('restored-pending')},${users[0]},7,'mfa',now()+interval '1 hour')`;
      await tx`INSERT INTO account_security_challenges (token_hash,user_id,context_hash,security_version,kind,expires_at)
        VALUES (${hash('restored-challenge')},${users[0]},${hash('context')},7,'passkey-login',now()+interval '1 hour')`;
      await tx`INSERT INTO account_security_proofs (token_hash,user_id,session_hash,security_version,expires_at)
        VALUES (${hash('restored-proof')},${users[0]},${hash('restored-session')},7,now()+interval '1 hour')`;
      await tx`INSERT INTO password_recovery_tokens (token_hash,user_id,password_fingerprint,expires_at)
        VALUES (${hash('restored-password-token')},${users[0]},${hash('password')},now()+interval '1 hour')`;
      await tx`INSERT INTO email_verification_tokens (token_hash,user_id,email,password_fingerprint,security_version,expires_at)
        VALUES (${hash('restored-verification-token')},${users[0]},'restore-0@example.test',${hash('password')},7,now()+interval '1 hour')`;
      await tx`INSERT INTO email_verification_mail (user_id,email) VALUES (${users[0]},'restore-0@example.test')`;
      await tx.unsafe(cleanup);
      for (const table of artifactTables) assert.equal((await tx`SELECT count(*)::int AS n FROM ${tx(table)}`)[0].n, 0, table);
      for (const [i, id] of users.entries()) {
        const [user] = await tx`SELECT * FROM app_users WHERE id=${id}`;
        assert.equal(String(user.security_version), '8');
        assert.equal(user.mfa_reset_required, i !== 4);
        assert.equal(user.password_hash, 'unchanged-password');
        assert.equal(new Date(user.email_verified_at).toISOString(), '2026-01-01T00:00:00.000Z');
      }
      assert.equal((await tx`SELECT count(*)::int AS n FROM audit_log WHERE action='restored_mfa_quarantined'`)[0].n, 5);
      // Re-running cleanup must not unlock previously quarantined users simply
      // because their old credential rows have already been removed.
      await tx.unsafe(cleanup);
      assert.equal((await tx`SELECT count(*)::int AS n FROM app_users WHERE mfa_reset_required`)[0].n, 5);
    });
  } finally { await sql.end(); }
});

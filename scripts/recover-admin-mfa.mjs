#!/usr/bin/env node
// Server-console recovery only. No HTTP endpoint, password reset or email bypass.
import { randomBytes, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RECOVERY_GRANT_MINUTES = 30;
const HELP = `Usage:
  node scripts/recover-admin-mfa.mjs --email admin@example.com [--dry-run]
  node scripts/recover-admin-mfa.mjs --email admin@example.com --execute \\
    --confirm-email admin@example.com --confirm-identity --reason 'Incident reference'

Read-only inspection is the default. Execution invalidates the account's sessions,
MFA factors, outstanding authentication state and recovery credentials. It issues
one 30-minute, single-use enrollment recovery code. The existing password is still
required, and a new factor must be verified before any full account/admin access.
Use --restored-account only for a non-admin already awaiting MFA recovery after
restore. Independently verify identity and preserve the incident record first.
The reason is hashed in the audit; do not include passwords, codes or other secrets.
`;

export class RecoveryOperationError extends Error {}
function fail(message) { throw new RecoveryOperationError(message); }
const normalizeEmail = value => String(value || '').trim().toLowerCase();
export function parseRecoveryArgs(args) {
  const options = { execute: false, dryRun: false, confirmIdentity: false, restoredAccount: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (seen.has(key)) fail('Repeated option. Use --help for supported arguments.');
    seen.add(key);
    if (key === '--help') { options.help = true; continue; }
    if (key === '--execute') { options.execute = true; continue; }
    if (key === '--dry-run') { options.dryRun = true; continue; }
    if (key === '--confirm-identity') { options.confirmIdentity = true; continue; }
    if (key === '--restored-account') { options.restoredAccount = true; continue; }
    const field = { '--email': 'email', '--confirm-email': 'confirmEmail', '--reason': 'reason' }[key];
    if (!field) fail('Unknown option. Use --help for supported arguments.');
    if (!args[i + 1] || args[i + 1].startsWith('--')) fail(`Missing value for ${key}`);
    options[field] = args[++i];
  }
  if (options.help) return options;
  options.email = normalizeEmail(options.email);
  if (options.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.email)) fail('Specify one exact account email with --email.');
  if (options.execute && options.dryRun) fail('--execute and --dry-run cannot be combined.');
  if (options.execute) {
    if (!options.confirmIdentity) fail('Execution requires --confirm-identity after independent identity verification.');
    if (normalizeEmail(options.confirmEmail) !== options.email) fail('--confirm-email must match the exact target account email.');
    options.reason = String(options.reason || '').trim();
    if (options.reason.length < 8 || options.reason.length > 300 || /[\x00-\x1f\x7f]/.test(options.reason)) fail('Execution requires a printable incident reason/reference of 8 to 300 characters.');
  }
  return options;
}

function assertTarget(user, options) {
  if (!user) fail('No account matches that email; nothing changed.');
  if (user.role !== 'admin' && !(options.restoredAccount && user.mfa_reset_required)) fail('Target is not an administrator. A restored non-admin awaiting MFA recovery also requires --restored-account.');
}

export async function recoverAdminMfa(sql, rawOptions) {
  // Revalidate programmatic callers as strictly as the CLI before any write.
  const args = ['--email', rawOptions.email || ''];
  if (rawOptions.restoredAccount) args.push('--restored-account');
  if (rawOptions.execute) args.push('--execute', '--confirm-email', rawOptions.confirmEmail || '', ...(rawOptions.confirmIdentity ? ['--confirm-identity'] : []), '--reason', rawOptions.reason || '');
  if (rawOptions.dryRun) args.push('--dry-run');
  const options = parseRecoveryArgs(args);
  const rows = await sql`SELECT id,email,role,mfa_reset_required,security_version FROM app_users WHERE lower(email)=${options.email}`;
  const account = rows[0];
  assertTarget(account, options);
  if (!options.execute) {
    const [counts] = await sql`SELECT
      (SELECT count(*)::int FROM account_totp_credentials WHERE user_id=${account.id}) AS totp,
      (SELECT count(*)::int FROM account_passkeys WHERE user_id=${account.id}) AS passkeys,
      (SELECT count(*)::int FROM sessions WHERE user_id=${account.id}) AS sessions,
      (SELECT count(*)::int FROM account_recovery_codes WHERE user_id=${account.id} AND used_at IS NULL AND (expires_at IS NULL OR expires_at>now())) AS recovery_codes`;
    return { executed: false, email: account.email, role: account.role, resetRequired: account.mfa_reset_required, ...counts };
  }
  const { recoveryCodeHash } = await import('../lib/account-security-logic.mjs');
  // 128 bits of entropy. The raw code exists only in memory and the one-time output.
  const code = randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g).join('-');
  return sql.begin(async tx => {
    // Same row lock as online account-security operations prevents enrollment races.
    const [user] = await tx`SELECT id,email,role,mfa_reset_required,security_version FROM app_users WHERE id=${account.id} FOR UPDATE`;
    assertTarget(user, options);
    if (normalizeEmail(user.email) !== options.email) fail('Account email changed during verification; inspect it again. Nothing changed.');
    await tx`DELETE FROM account_security_proofs WHERE user_id=${user.id}`;
    await tx`DELETE FROM sessions WHERE user_id=${user.id}`;
    await tx`DELETE FROM account_pending_auth WHERE user_id=${user.id}`;
    await tx`DELETE FROM account_security_challenges WHERE user_id=${user.id}`;
    await tx`DELETE FROM account_recovery_codes WHERE user_id=${user.id}`;
    await tx`DELETE FROM account_totp_credentials WHERE user_id=${user.id}`;
    await tx`DELETE FROM account_passkeys WHERE user_id=${user.id}`;
    await tx`DELETE FROM password_recovery_tokens WHERE user_id=${user.id}`;
    await tx`DELETE FROM email_verification_tokens WHERE user_id=${user.id}`;
    await tx`DELETE FROM email_verification_mail WHERE user_id=${user.id} OR lower(email)=${options.email}`;
    await tx`UPDATE password_recovery_mail SET status='expired', lease_token=NULL, lease_until=NULL,
      finished_at=now(), expires_at=now(), last_error='OPERATOR_MFA_RECOVERY'
      WHERE lower(email)=${options.email} AND status IN ('queued','sending')`;
    await tx`UPDATE app_users SET security_version=security_version+1,mfa_reset_required=true WHERE id=${user.id}`;
    const codeHash = recoveryCodeHash(user.id, code);
    const [grant] = await tx`INSERT INTO account_recovery_codes (code_hash,user_id,expires_at)
      VALUES (${codeHash},${user.id},now()+interval '30 minutes') RETURNING expires_at`;
    // Keep only a digest of the incident reference; never persist the grant or reason.
    const detail = { operator_identity_verified: true, reason_sha256: createHash('sha256').update(options.reason).digest('hex'), restored_account: options.restoredAccount, expires_in_minutes: RECOVERY_GRANT_MINUTES };
    await tx`INSERT INTO audit_log (user_id,action,detail) VALUES (${user.id},'operator_mfa_recovery',${tx.json(detail)})`;
    return { executed: true, email: user.email, role: user.role, code, expiresAt: grant.expires_at };
  });
}

export async function main(args = process.argv.slice(2), { stdout = console.log, stderr = console.error } = {}) {
  let database;
  try {
    const options = parseRecoveryArgs(args);
    if (options.help) { stdout(HELP); return 0; }
    database = await import('../lib/db.mjs');
    const result = await recoverAdminMfa(database.db(), options);
    if (!result.executed) {
      stdout(`DRY RUN: ${result.email} (${result.role}); reset required: ${result.resetRequired}; TOTP: ${result.totp}; passkeys: ${result.passkeys}; sessions: ${result.sessions}; active recovery codes: ${result.recovery_codes}.`);
      stdout('No changes made. Read docs/ACCOUNT_SECURITY_OPERATIONS.md before recovery.');
    } else {
      stdout(`Recovery prepared for ${result.email}. All previous authentication credentials except the password were revoked.`);
      stdout(`Single-use recovery code (shown once; expires ${new Date(result.expiresAt).toISOString()}): ${result.code}`);
      stdout('Give this only to the independently verified account holder over a trusted private channel. Sign in with the existing password, use this code, and verify a new factor before accessing the account.');
    }
    return 0;
  } catch (error) {
    // Driver exceptions can contain SQL/parameters/connection credentials. Never print them.
    stderr(error instanceof RecoveryOperationError ? error.message : 'MFA recovery did not return a usable result. Verify the database connection and current migrations. Keep services restricted and inspect the account again before retrying; a lost database acknowledgment may hide a committed recovery.');
    return 1;
  } finally {
    if (database) {
      try { await database.closeDatabase(); }
      catch { stderr('Database connection cleanup did not complete; do not share raw driver diagnostics.'); }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();

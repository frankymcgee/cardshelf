#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
if [ "$#" -ne 2 ] || [ "$2" != '--confirm-restore' ] || [ ! -f "$1" ]; then
  echo 'Usage: sh scripts/restore.sh backups/cardshelf-YYYYMMDDTHHMMSSZ.dump --confirm-restore' >&2
  echo 'This replaces the current database. Application and worker will be stopped.' >&2
  exit 1
fi
DUMP="$1"
# Validate the archive header before stopping services.
sh scripts/compose.sh exec -T db pg_restore --list < "$DUMP" > /dev/null
echo 'Stopping application and worker before the restore...'
sh scripts/compose.sh stop app worker
# Keep a safety copy of the current database. Abort if it cannot be backed up.
if ! sh scripts/backup.sh; then
  echo 'Safety backup failed. Database has not been replaced; app and worker remain stopped.' >&2
  exit 1
fi
if ! sh scripts/compose.sh exec -T db pg_restore -U cardshelf -d cardshelf --clean --if-exists --no-owner --single-transaction --exit-on-error < "$DUMP"; then
  echo 'Restore failed and was rolled back. App and worker remain stopped; inspect the error before restarting.' >&2
  exit 1
fi
# Run migrations before cleanup so even old backups gain the current security schema.
if ! sh scripts/compose.sh run --rm migrate; then
  echo 'Restore migrations failed. App and worker remain stopped; do not restart before security cleanup succeeds.' >&2
  exit 1
fi
# Historical sessions/reset links and unsent mail must not become active again.
# Preserve password/notification delivery history, suppressions and integrations.
if ! sh scripts/compose.sh exec -T db psql -U cardshelf -d cardshelf -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
-- A backup can contain credentials revoked after it was created. Never silently
-- trust them again. All restored admins require verified recovery: an archive
-- predating their MFA enrollment contains no factor with which to detect it.
-- Record other protected accounts BEFORE deleting factors/codes. A correct
-- password alone cannot remove this flag.
UPDATE app_users SET security_version=security_version+1,
  mfa_reset_required=(role='admin' OR mfa_reset_required
    OR EXISTS (SELECT 1 FROM account_totp_credentials WHERE user_id=app_users.id)
    OR EXISTS (SELECT 1 FROM account_passkeys WHERE user_id=app_users.id)
    OR EXISTS (SELECT 1 FROM account_recovery_codes WHERE user_id=app_users.id));
INSERT INTO audit_log (user_id,action,detail)
  SELECT id,'restored_mfa_quarantined','{"operator_recovery_required":true}'::jsonb
  FROM app_users WHERE mfa_reset_required;
DELETE FROM account_security_proofs;
DELETE FROM sessions;
DELETE FROM account_pending_auth;
DELETE FROM account_security_challenges;
DELETE FROM account_recovery_codes;
DELETE FROM account_totp_credentials;
DELETE FROM account_passkeys;
DELETE FROM password_recovery_tokens;
DELETE FROM email_verification_tokens;
DELETE FROM email_verification_mail;
UPDATE jobs SET status='queued', lease_token=NULL, message='Queued after restore' WHERE status='running';
UPDATE password_recovery_mail SET status='expired', lease_token=NULL, lease_until=NULL,
  finished_at=now(), expires_at=now(), last_error='DATABASE_RESTORED'
  WHERE status IN ('queued','sending');
UPDATE email_outbox SET status='expired', lease_token=NULL, lease_until=NULL,
  finished_at=now(), updated_at=now(), expires_at=now(), last_error='DATABASE_RESTORED'
  WHERE status IN ('queued','sending');
-- A restored host must verify its own SMTP connection. Keep credentials,
-- enablement and history, but do not reuse a check from the previous host.
UPDATE email_settings SET smtp_verified_at=NULL, smtp_verified_revision=NULL
  WHERE singleton AND provider='smtp';
COMMIT;
SQL
then
  echo 'Restored credentials could not be invalidated. App and worker remain stopped; do not restart until security cleanup succeeds.' >&2
  exit 1
fi
sh scripts/compose.sh up -d app worker
echo 'Database restored. Previous MFA factors and recovery codes are quarantined by removal; affected accounts require verified server-operator recovery and fresh enrollment.'
echo 'Follow docs/ACCOUNT_SECURITY_OPERATIONS.md. Verify sign-in, collections and binder layouts now.'

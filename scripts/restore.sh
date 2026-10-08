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
# Run migrations before expiring mail so older backups gain the current queue schema.
sh scripts/compose.sh run --rm migrate
# Historical sessions/reset links and unsent mail must not become active again.
# Preserve accepted/delivered history, suppression lists and integration settings.
sh scripts/compose.sh exec -T db psql -U cardshelf -d cardshelf -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM sessions;
DELETE FROM password_recovery_tokens;
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
sh scripts/compose.sh up -d app worker
echo 'Database restored. Verify sign-in, collections and binder layouts now.'

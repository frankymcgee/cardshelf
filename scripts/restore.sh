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
docker compose exec -T db pg_restore --list < "$DUMP" > /dev/null
echo 'Stopping application and worker before the restore...'
docker compose stop app worker
# Keep a safety copy of the current database. Abort if it cannot be backed up.
if ! sh scripts/backup.sh; then
  echo 'Safety backup failed. Database has not been replaced; app and worker remain stopped.' >&2
  exit 1
fi
if ! docker compose exec -T db pg_restore -U cardshelf -d cardshelf --clean --if-exists --no-owner --single-transaction --exit-on-error < "$DUMP"; then
  echo 'Restore failed and was rolled back. App and worker remain stopped; inspect the error before restarting.' >&2
  exit 1
fi
# Restoring a historical dump must not revive previously signed-out sessions.
docker compose exec -T db psql -U cardshelf -d cardshelf -v ON_ERROR_STOP=1 -c "DELETE FROM sessions; UPDATE jobs SET status='queued', lease_token=NULL, message='Queued after restore' WHERE status='running';"
# Run any migrations for the currently installed application version.
docker compose run --rm migrate
docker compose up -d app worker
echo 'Database restored. Verify sign-in, collections and binder layouts now.'

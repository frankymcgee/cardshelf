#!/bin/sh
# Postal data is separate from CardShelf's PostgreSQL backup.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
umask 077
[ -f deploy/postal/.enabled ] || { echo 'Postal has not been configured.' >&2; exit 1; }
mkdir -p backups
chmod 700 backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
output="backups/postal-$stamp.sql"
[ ! -e "$output" ] || { echo 'A Postal backup already exists for this timestamp.' >&2; exit 1; }
temporary="$output.tmp"
trap 'rm -f "$temporary"' 0 HUP INT TERM
# Expand the container's existing secret inside the container, never in argv/output.
# --all-databases includes Postal's main DB and every dynamically created message DB.
sh scripts/compose.sh exec -T postal-db sh -eu -c '
  export MYSQL_PWD="$MARIADB_ROOT_PASSWORD"
  exec mariadb-dump --user=root --all-databases --single-transaction --quick --routines --events --triggers --hex-blob
' > "$temporary"
[ -s "$temporary" ] || { echo 'Postal database backup was empty.' >&2; exit 1; }
mv "$temporary" "$output"
chmod 600 "$output"
sha256sum "$output" > "$output.sha256"
printf 'Postal database backup created: %s\n' "$output"
printf 'Separately back up the private deploy/postal/config directory, deploy/postal/.env and root .env; see docs/POSTAL_EMAIL.md.\n'

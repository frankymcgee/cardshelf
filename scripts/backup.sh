#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
umask 077
mkdir -p backups
chmod 700 backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="backups/cardshelf-$STAMP.dump"
if [ -e "$OUT" ]; then echo "Backup already exists: $OUT" >&2; exit 1; fi
TMP="$OUT.tmp"
trap 'rm -f "$TMP"' EXIT HUP INT TERM
# A pg_dump custom-format snapshot includes catalogue, users, sessions, binders,
# ownership, import jobs and schema history. It does not include .env secrets.
docker compose exec -T db pg_dump -U cardshelf -d cardshelf --format=custom --no-owner > "$TMP"
[ -s "$TMP" ] || { echo 'The backup is empty.' >&2; exit 1; }
mv "$TMP" "$OUT"
chmod 600 "$OUT"
if command -v sha256sum >/dev/null 2>&1; then sha256sum "$OUT" > "$OUT.sha256"; fi
printf 'Database backup created: %s\n' "$OUT"
printf 'Copy this dump and a separately secured .env backup off-server.\n'

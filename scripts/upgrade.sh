#!/bin/sh
# Run from a checked-out, validated release with Docker access. No DNS/TLS changes.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
[ -f .env ] || { echo 'No .env found. Use configure.sh for a first installation.' >&2; exit 1; }
VERSION=$(sed -n 's/.*"version": *"\([0-9][0-9.]*\)".*/\1/p' package.json | head -n 1)
[ -n "$VERSION" ] || { echo 'Cannot determine release version.' >&2; exit 1; }
export APP_VERSION="$VERSION"
printf 'Building CardShelf %s. The running site is not stopped during the build.\n' "$VERSION"
sh scripts/compose.sh build
# Automatic local safety dump immediately before changing the database.
# A failed build or backup leaves the old site running.
sh scripts/backup.sh
sh scripts/compose.sh stop app worker
if ! sh scripts/compose.sh run --rm migrate; then
  echo 'Migration failed. App/worker remain stopped; inspect the error and backup before proceeding.' >&2
  exit 1
fi
# Persist only the non-secret version, retaining ownership and private permissions.
umask 077
TMP=$(mktemp .env.upgrade.XXXXXX)
trap 'rm -f "$TMP"' EXIT HUP INT TERM
sed '/^APP_VERSION=/d' .env > "$TMP"
printf '\nAPP_VERSION=%s\n' "$VERSION" >> "$TMP"
chown --reference=.env "$TMP"
chmod 600 "$TMP"
mv "$TMP" .env
# Migrations already completed. Keep the existing database and proxy alone.
sh scripts/compose.sh up -d --no-deps --wait --wait-timeout 180 app worker
sh scripts/compose.sh ps -a
printf 'CardShelf %s is running. Check the new features in your browser.\n' "$VERSION"

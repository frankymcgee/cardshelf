#!/bin/sh
# Run from the package root. POSIX shell; Docker is not needed for this step.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
umask 077
if [ -e .env ]; then
  echo 'Refusing to overwrite .env. Edit it manually or move it aside after a backup.' >&2
  exit 1
fi
ORIGIN="${1:-https://tcg.webwire.cloud}"
# Permit only a straightforward origin; disallow shell, dotenv and URL injection.
if ! printf '%s' "$ORIGIN" | grep -Eq '^https?://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?$'; then
  echo 'Usage: sh scripts/configure.sh https://tcg.webwire.cloud' >&2
  echo 'Use an origin without a path, query, credentials or trailing slash.' >&2
  exit 1
fi
# The supplied HTTPS proxy listens on standard ports; keep origin/cookie checks exact.
case "$ORIGIN" in
  https://*:443) ORIGIN=${ORIGIN%:443} ;;
  https://*:[0-9]*) echo 'The supplied HTTPS configuration requires standard port 443 (omit the port).' >&2; exit 1 ;;
  http://*:[0-9]*) ;;
  http://*) echo 'For HTTP evaluation, include the port: http://localhost:3000' >&2; exit 1 ;;
esac
DOMAIN=$(printf '%s' "$ORIGIN" | sed -E 's#^https?://##; s/:[0-9]+$//')
PORT=$(printf '%s' "$ORIGIN" | sed -nE 's#^http://[^:]+:([0-9]+)$#\1#p')
PORT=${PORT:-3000}
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo 'The HTTP port must be between 1 and 65535.' >&2; exit 1
fi
TRUST=false
case "$ORIGIN" in https://*) TRUST=true;; esac
random_hex() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
DB_PASSWORD=$(random_hex)
BOOTSTRAP=$(random_hex)
INTEGRATION_KEY=$(random_hex)
cat > .env <<EOF
APP_VERSION=0.14.3
APP_ORIGIN=$ORIGIN
APP_DOMAIN=$DOMAIN
APP_BIND=127.0.0.1
APP_PORT=$PORT
POSTGRES_PASSWORD=$DB_PASSWORD
BOOTSTRAP_TOKEN=$BOOTSTRAP
CARDSHELF_INTEGRATION_KEY=$INTEGRATION_KEY
TRUST_PROXY=$TRUST
CATALOGUE_REQUEST_INTERVAL_MS=300
EOF
chmod 600 .env
printf '\nCreated .env for %s\n' "$ORIGIN"
printf 'First-use setup token: %s\n' "$BOOTSTRAP"
printf 'Keep this token and .env private. The setup screen closes after the first account.\n'
printf 'Database and application ports are not exposed publicly by default.\n'

#!/bin/sh
# Copy a currently valid Caddy certificate chain/key and reload only Postal SMTP.
# Run after Caddy issuance and hourly/daily from the deployment user's scheduler.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
umask 077
[ -f deploy/postal/.enabled ] || { echo 'Postal has not been configured.' >&2; exit 1; }
[ ! -L deploy/postal/config ] && [ -d deploy/postal/config ] || { echo 'Postal config must be a real directory.' >&2; exit 1; }
for utility in docker openssl date cmp cp mktemp; do
  command -v "$utility" >/dev/null 2>&1 || { printf 'Missing required utility: %s\n' "$utility" >&2; exit 1; }
done
lock=deploy/postal/.smtp-sync.lock
mkdir "$lock" 2>/dev/null || { echo 'A certificate sync is already running (or a stale lock needs inspection).' >&2; exit 1; }
temporary=''
trap '[ -z "$temporary" ] || rm -rf "$temporary"; rmdir "$lock" 2>/dev/null || true' 0 HUP INT TERM
temporary=$(mktemp -d "${TMPDIR:-/tmp}/cardshelf-postal-tls.XXXXXX")
# Caddy storage can contain multiple ACME issuers. Inspect each matching hostname
# and select the valid certificate with the furthest expiry; no issuer is assumed.
sh scripts/compose.sh exec -T caddy find /data/caddy/certificates -type f -name smtp.cardshelf.cloud.crt > "$temporary/paths"
best_expiry=0
candidate=0
while IFS= read -r certificate_path; do
  case "$certificate_path" in
    /data/caddy/certificates/*/smtp.cardshelf.cloud/smtp.cardshelf.cloud.crt) ;;
    *) continue ;;
  esac
  candidate=$((candidate+1))
  certificate="$temporary/cert.$candidate"
  private_key="$temporary/key.$candidate"
  sh scripts/compose.sh exec -T caddy cat "$certificate_path" > "$certificate"
  sh scripts/compose.sh exec -T caddy cat "${certificate_path%.crt}.key" > "$private_key"
  openssl x509 -in "$certificate" -noout -checkhost smtp.cardshelf.cloud >/dev/null 2>&1 || continue
  openssl x509 -in "$certificate" -noout -checkend 86400 >/dev/null 2>&1 || continue
  # Check the whole chain, certificate purpose and notBefore as well as hostname.
  # This rejects stale ACME staging/self-signed certificates in Caddy storage.
  openssl verify -purpose sslserver -verify_hostname smtp.cardshelf.cloud -untrusted "$certificate" "$certificate" >/dev/null 2>&1 || continue
  openssl x509 -in "$certificate" -pubkey -noout > "$temporary/cert.pub"
  openssl pkey -in "$private_key" -pubout > "$temporary/key.pub" 2>/dev/null || continue
  cmp -s "$temporary/cert.pub" "$temporary/key.pub" || continue
  expiry_text=$(openssl x509 -in "$certificate" -enddate -noout)
  expiry=$(date -u -d "${expiry_text#notAfter=}" +%s) || continue
  if [ "$expiry" -gt "$best_expiry" ]; then
    best_expiry=$expiry
    cp "$certificate" "$temporary/smtp.cert"
    cp "$private_key" "$temporary/smtp.key"
  fi
done < "$temporary/paths"
[ "$best_expiry" -gt 0 ] || { echo 'No valid Caddy certificate/key for smtp.cardshelf.cloud was found. Check DNS and Caddy issuance; SMTP was not changed.' >&2; exit 1; }
chmod 600 "$temporary/smtp.cert" "$temporary/smtp.key"
# Only these two generated files are installed. Refuse symlinks and keep other
# Postal secrets untouched. A private status file reports whether reload is needed.
docker run --rm --network none --user 0:0 --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER \
  --volume "$PWD/deploy/postal/config:/config:rw" --volume "$temporary:/incoming:rw" \
  --entrypoint sh ghcr.io/postalserver/postal:3.3.7 -eu -c '
    [ ! -L /config/smtp.cert ] && [ ! -L /config/smtp.key ]
    if cmp -s /incoming/smtp.cert /config/smtp.cert && cmp -s /incoming/smtp.key /config/smtp.key; then
      printf "unchanged\n" > /incoming/status
      exit 0
    fi
    for name in smtp.cert smtp.key; do
      [ ! -L "/config/$name.new" ]
      cp "/incoming/$name" "/config/$name.new"
      chown 999:999 "/config/$name.new"
      chmod 600 "/config/$name.new"
      mv "/config/$name.new" "/config/$name"
    done
    printf "changed\n" > /incoming/status
  '
status=$(cat "$temporary/status")
if [ "$status" = changed ]; then
  # A restart is necessary: Postal caches its certificate and SSLContext in memory.
  smtp_id=$(sh scripts/compose.sh ps -q postal-smtp)
  if [ -n "$smtp_id" ]; then
    sh scripts/compose.sh restart postal-smtp
    echo 'Updated the SMTP certificate and restarted Postal SMTP.'
  else
    echo 'SMTP certificate installed. Start postal-smtp using scripts/compose.sh.'
  fi
else
  echo 'SMTP certificate is unchanged; no restart was needed.'
fi

#!/bin/sh
# Generates private local bootstrap material only. No services, DNS or account changes.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
umask 077
[ "$#" -eq 0 ] || { echo 'Usage: sh scripts/configure-postal.sh' >&2; exit 1; }
[ -f .env ] && [ -r .env ] || { echo 'Configure CardShelf first; the root .env is missing.' >&2; exit 1; }
for command in openssl mktemp sed grep; do
  command -v "$command" >/dev/null 2>&1 || { printf 'Install the required utility first: %s\n' "$command" >&2; exit 1; }
done
# Never source dotenv as shell code, and never silently alter the live site domain/key.
[ "$(grep -c '^APP_ORIGIN=' .env || true)" -eq 1 ] && [ "$(sed -n 's/^APP_ORIGIN=//p' .env)" = 'https://cardshelf.cloud' ] || {
  echo 'Set APP_ORIGIN=https://cardshelf.cloud and APP_DOMAIN=cardshelf.cloud in the existing root .env after arranging its DNS/certificate. No settings were changed.' >&2; exit 1;
}
[ "$(grep -c '^APP_DOMAIN=' .env || true)" -eq 1 ] && [ "$(sed -n 's/^APP_DOMAIN=//p' .env)" = 'cardshelf.cloud' ] || {
  echo 'APP_DOMAIN must be cardshelf.cloud for this deployment. No settings were changed.' >&2; exit 1;
}
[ "$(grep -c '^CARDSHELF_INTEGRATION_KEY=' .env || true)" -eq 1 ] && sed -n 's/^CARDSHELF_INTEGRATION_KEY=//p' .env | grep -Eq '^[A-Fa-f0-9]{64}$' || {
  echo 'Create the integration encryption key with sh scripts/configure-integrations.sh first. An existing key must never be rotated casually.' >&2; exit 1;
}
for path in deploy/postal/config deploy/postal/.env deploy/postal/.enabled; do
  [ ! -e "$path" ] && [ ! -L "$path" ] || { printf 'Refusing to overwrite existing Postal configuration: %s\n' "$path" >&2; exit 1; }
done
[ ! -L deploy ] && [ ! -L deploy/postal ] || { echo 'The deployment directories must not be symlinks.' >&2; exit 1; }
staging=$(mktemp -d deploy/postal/.bootstrap.XXXXXX)
trap 'rm -rf "$staging"' 0 HUP INT TERM
mkdir "$staging/config"
postal_db_password=$(openssl rand -hex 32)
postal_rails_secret=$(openssl rand -hex 64)
printf '%s' "$postal_db_password" | grep -Eq '^[a-f0-9]{64}$'
printf '%s' "$postal_rails_secret" | grep -Eq '^[a-f0-9]{128}$'
openssl genrsa -out "$staging/config/signing.key" 2048 2>/dev/null
openssl pkey -in "$staging/config/signing.key" -pubout -out "$staging/config/signing-public.pem" 2>/dev/null
cat > "$staging/.env" <<EOF_ENV
POSTAL_DB_PASSWORD=$postal_db_password
EOF_ENV
cat > "$staging/config/postal.yml" <<EOF_YAML
version: 2
postal:
  web_hostname: postal.cardshelf.cloud
  web_protocol: https
  smtp_hostname: smtp.cardshelf.cloud
  use_ip_pools: false
  # Exact webhook destination on the shared proxy, allowed through Postal's SSRF guard.
  allowed_request_destinations: [cardshelf.cloud]
  signing_key_path: /config/signing.key
web_server:
  default_port: 5000
  default_bind_address: 0.0.0.0
main_db:
  host: postal-db
  username: root
  password: "$postal_db_password"
  database: postal
message_db:
  host: postal-db
  username: root
  password: "$postal_db_password"
  database_name_prefix: postal
smtp_server:
  default_bind_address: 0.0.0.0
  default_port: 25
  tls_enabled: true
  tls_certificate_path: /config/smtp.cert
  tls_private_key_path: /config/smtp.key
  # Postal's documented ssl_version option maps to Ruby OpenSSL; this is TLS 1.2 only.
  ssl_version: TLSv1_2
  max_message_size: 14
dns:
  mx_records: [smtp.cardshelf.cloud]
  spf_include: spf.postal.cardshelf.cloud
  return_path_domain: rp.postal.cardshelf.cloud
  route_domain: routes.postal.cardshelf.cloud
  helo_hostname: smtp.cardshelf.cloud
  dkim_identifier: postal
  custom_return_path_prefix: psrp
rails:
  secret_key: "$postal_rails_secret"
EOF_YAML
chmod 600 "$staging/.env" "$staging/config/"*
mv "$staging/config" deploy/postal/config
mv "$staging/.env" deploy/postal/.env
printf 'postal-3.3.7\n' > deploy/postal/.enabled
printf 'Generated private Postal configuration; existing CardShelf settings were preserved.\n'
printf 'Follow docs/POSTAL_EMAIL.md to prepare permissions, initialize Postal, issue TLS certificates and create its first administrator.\n'
printf 'Use sh scripts/compose.sh for this combined deployment, including upgrades.\n'

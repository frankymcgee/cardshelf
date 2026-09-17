#!/bin/sh
# One-time encryption-key setup for an existing deployment. Does not touch billing flags.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
umask 077
[ -f .env ] && [ -r .env ] || { echo 'Run the initial site configuration first; .env was not found.' >&2; exit 1; }
count=$(grep -c '^CARDSHELF_INTEGRATION_KEY=' .env || true)
[ "$count" -le 1 ] || { echo 'Multiple integration keys found. Resolve them manually without replacing a key in use.' >&2; exit 1; }
old=$(sed -n 's/^CARDSHELF_INTEGRATION_KEY=//p' .env)
if [ -n "$old" ]; then
  printf '%s' "$old" | grep -Eq '^[A-Fa-f0-9]{64}$' || { echo 'Existing integration key is invalid. It has NOT been changed.' >&2; exit 1; }
  echo 'Integration encryption key already exists. It has not been changed.'
  exit 0
fi
temp=$(mktemp .env.integration.XXXXXX)
trap 'rm -f "$temp"' 0 HUP INT TERM
awk '!/^CARDSHELF_INTEGRATION_KEY=/' .env > "$temp"
key=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
printf '%s' "$key" | grep -Eq '^[a-f0-9]{64}$' || { echo 'Secure key generation failed; .env was not changed.' >&2; exit 1; }
printf '\nCARDSHELF_INTEGRATION_KEY=%s\n' "$key" >> "$temp"
chmod 600 "$temp"
mv "$temp" .env
echo 'Created a private integration encryption key. Keep a secure off-server copy of .env.'
echo 'Recreate the application with your existing Compose configuration to load it.'
echo 'Never replace this key while encrypted Square credentials are in use.'

#!/bin/sh
# Only host-side operational files belong here. App versions and secrets do not.
# Including this list itself also makes additions/removals change the contract.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
FILES='compose.yaml
compose.https.yaml
Caddyfile
scripts/compose.sh
scripts/upgrade.sh
scripts/deployment-contract.sh
scripts/backup.sh
scripts/restore.sh
deploy/postal/compose.postal.yaml
deploy/postal/Caddyfile
deploy/postal/prepare-permissions.sh
deploy/postal/sync-certificates.sh'
if [ "${1:-}" = --files ]; then
  printf '%s\n' "$FILES"
else
  # Do not pipeline sha256sum directly: a missing input must fail this script.
  HASHES=$(printf '%s\n' "$FILES" | xargs sha256sum)
  printf '%s\n' "$HASHES" | sha256sum | cut -d ' ' -f 1
fi

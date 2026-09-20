#!/bin/sh
# One entry point for ordinary installs and the optional same-host Postal overlay.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
if [ -f deploy/postal/.enabled ]; then
  [ -f deploy/postal/.env ] || { echo 'Postal is enabled but its private .env is missing. Restore it before proceeding.' >&2; exit 1; }
  exec docker compose --env-file .env --env-file deploy/postal/.env -f compose.yaml -f compose.https.yaml -f deploy/postal/compose.postal.yaml "$@"
fi
# Keep existing COMPOSE_FILE / default-file behavior for installations without Postal.
exec docker compose "$@"

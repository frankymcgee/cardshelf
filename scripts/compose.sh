#!/bin/sh
# One entry point for installs and the one-time retirement of the former overlay.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
if [ -f deploy/postal/.enabled ]; then
  # Retain the old installation's HTTPS choice without loading any mail services
  # or requiring its removed Compose file/private credentials.
  exec docker compose --env-file .env -f compose.yaml -f compose.https.yaml "$@"
fi
# Keep existing COMPOSE_FILE / default-file behavior for ordinary installations.
exec docker compose "$@"

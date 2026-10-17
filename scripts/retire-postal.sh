#!/bin/sh
# One-time removal of this Compose project's retired mail services.
# No global prune, shared certificate deletion or application-volume removal.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
[ "$#" -eq 0 ] || { [ "$#" -eq 1 ] && [ "$1" = --purge-data ]; } || {
  echo 'Usage: sh scripts/retire-postal.sh [--purge-data]' >&2; exit 1;
}
[ -f .env ] && [ ! -L .env ] && [ ! -L deploy ] && [ ! -L deploy/postal ] || {
  echo 'A regular .env and deployment directories are required.' >&2; exit 1;
}
umask 077
exec 8>.cardshelf-mail-retirement.lock
flock -n 8 || { echo 'Mail retirement is already running.' >&2; exit 1; }
# Derive the project from its existing database container, including custom names.
database=$(sh scripts/compose.sh ps --all --quiet db)
[ -n "$database" ] || { echo 'Cannot identify the installed CardShelf database container.' >&2; exit 1; }
project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$database")
case "$project" in ''|*[!a-zA-Z0-9_.-]*) echo 'Invalid Compose project identity.' >&2; exit 1 ;; esac
temporary=$(mktemp .env.retire.XXXXXX)
trap 'rm -f "$temporary"' EXIT
trap 'exit 1' HUP INT TERM
sed '/^POSTAL_ORIGIN=/d' .env > "$temporary"
if [ -f deploy/postal/.enabled ]; then
  # The old wrapper selected HTTPS unconditionally. Persist that choice before
  # removing its marker, and restore the original app Caddyfile and volumes.
  sed '/^COMPOSE_FILE=/d' "$temporary" > "$temporary.https"
  mv "$temporary.https" "$temporary"
  printf '\nCOMPOSE_FILE=compose.yaml:compose.https.yaml\n' >> "$temporary"
  docker compose --env-file "$temporary" -f compose.yaml -f compose.https.yaml config --quiet
  docker compose --env-file "$temporary" -f compose.yaml -f compose.https.yaml up -d --no-deps --force-recreate caddy
  docker compose --env-file "$temporary" -f compose.yaml -f compose.https.yaml exec -T caddy caddy validate --config /etc/caddy/Caddyfile
fi
chown --reference=.env "$temporary"
chmod 600 "$temporary"
mv "$temporary" .env
rm -f deploy/postal/.enabled
# Match both Compose labels, never just a substring of a container/resource name.
for service in postal-web postal-worker postal-smtp postal-db; do
  ids=$(docker ps --all --quiet --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$service")
  for id in $ids; do docker stop --time 30 "$id"; docker rm "$id"; done
done
for network in postal_internal postal_proxy postal_egress; do
  ids=$(docker network ls --quiet --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.network=$network")
  for id in $ids; do docker network rm "$id"; done
done
# Remove only this checkout's certificate/backup schedules from the invoking
# account. Preserve the original crontab privately before changing it.
if command -v crontab >/dev/null 2>&1; then
  if crontab -l > "$temporary" 2>/dev/null; then
    root=$(pwd)
    awk -v sync="$root/deploy/postal/sync-certificates.sh" -v backup="$root/deploy/postal/backup.sh" \
      'index($0,sync)==0 && index($0,backup)==0' "$temporary" > "$temporary.filtered"
    if ! cmp -s "$temporary" "$temporary.filtered"; then
      mkdir -p backups
      cp "$temporary" "backups/crontab-before-mail-retirement-$(date -u +%Y%m%dT%H%M%SZ)-$$.txt"
      crontab "$temporary.filtered"
    fi
    rm -f "$temporary.filtered"
  fi
fi
if [ "${1:-}" = --purge-data ]; then
  ids=$(docker volume ls --quiet --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.volume=postal_database')
  for id in $ids; do docker volume rm "$id"; done
  rm -rf -- deploy/postal
  echo 'Retired mail services, networks, private configuration and database volume removed.'
else
  echo 'Retired mail services and networks removed. Private mail files/database retained for recovery.'
  echo 'To permanently remove that retired mail data: sudo sh scripts/retire-postal.sh --purge-data'
fi
echo 'Check other accounts and system schedulers for any separately installed mail certificate/backup jobs.'

#!/usr/bin/env bash
# Isolated CI rehearsal. Never reads a real installation's .env or database.
set -euo pipefail
[[ ${CARDSHELF_IMAGE_TEST:-} == yes ]] || { echo 'Set CARDSHELF_IMAGE_TEST=yes for disposable image tests.' >&2; exit 1; }
image=${1:?Pass the locally built image tag}
source_root=$(cd -- "$(dirname -- "$0")/.." && pwd)
test_dir=$(mktemp -d)
registry_id=''
export COMPOSE_PROJECT_NAME="cardshelf-image-$(date +%s)-$$"
unset COMPOSE_FILE COMPOSE_ENV_FILES CARDSHELF_IMAGE APP_VERSION
cleanup() {
  result=$?
  trap - EXIT
  if [[ -f "$test_dir/.env" ]]; then
    (cd "$test_dir" && sh scripts/compose.sh logs --no-color --tail=100) || true
    (cd "$test_dir" && sh scripts/compose.sh down --volumes --remove-orphans) || true
  fi
  if [[ -n "$registry_id" ]]; then docker rm -f "$registry_id" >/dev/null || true; fi
  rm -rf "$test_dir"
  exit "$result"
}
trap cleanup EXIT
while IFS= read -r file; do
  mkdir -p "$test_dir/$(dirname "$file")"
  cp "$source_root/$file" "$test_dir/$file"
done < <(sh "$source_root/scripts/deployment-contract.sh" --files)
version=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$image")
[[ $(docker image inspect --format '{{.Config.User}}' "$image") == node ]]
# Exercise Sharp's platform-specific production dependency after npm prune.
docker run --rm --network none --entrypoint node "$image" --input-type=module -e \
  'import sharp from "sharp"; const b=await sharp({create:{width:2,height:2,channels:3,background:"red"}}).png().toBuffer(); if (!b.length) process.exit(1);'
registry_id=$(docker run -d -p 127.0.0.1::5000 registry:2)
registry_address=$(docker port "$registry_id" 5000/tcp)
repository="$registry_address/cardshelf"
docker tag "$image" "$repository:stable"
docker push "$repository:stable"
cd "$test_dir"
umask 077
cat > .env <<ENV
CARDSHELF_IMAGE=$image
APP_VERSION=$version
POSTGRES_PASSWORD=image-test-only-password
BOOTSTRAP_TOKEN=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
CARDSHELF_INTEGRATION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
APP_ORIGIN=http://localhost:3000
APP_BIND=127.0.0.1
APP_PORT=0
EMAIL_WORKER_ENABLED=false
PRICE_TRACKING_ENABLED=false
ENV
sh scripts/compose.sh up -d --wait --wait-timeout 180
before_db=$(sh scripts/compose.sh ps -q db)
before_app=$(sh scripts/compose.sh ps -q app)
# Exercise the pruned Web Push runtime and persistence across the real upgrade.
push_key_before=$(sh scripts/compose.sh exec -T app node --input-type=module -e 'import {pushIdentity} from "./lib/push.mjs"; import {closeDatabase} from "./lib/db.mjs"; console.log((await pushIdentity()).public_key); await closeDatabase();')
[[ -n "$push_key_before" ]]
# A changed host contract must be rejected before stopping the healthy site.
cp compose.yaml compose.yaml.original
printf '\n# incompatible local deployment fixture\n' >> compose.yaml
if CARDSHELF_IMAGE_REPOSITORY="$repository" sh scripts/upgrade.sh > contract-error.log 2>&1; then
  echo 'Expected the deployment mismatch to be rejected.' >&2; exit 1
fi
grep -q 'different server deployment files' contract-error.log
[[ $(sh scripts/compose.sh ps -q app) == "$before_app" ]]
[[ $(docker inspect --format '{{.State.Health.Status}}' "$before_app") == healthy ]]
mv compose.yaml.original compose.yaml
# Exercise the exact operator command, including pull, backup and migration.
CARDSHELF_IMAGE_REPOSITORY="$repository" sh scripts/upgrade.sh
push_key_after=$(sh scripts/compose.sh exec -T app node --input-type=module -e 'import {pushIdentity} from "./lib/push.mjs"; import {closeDatabase} from "./lib/db.mjs"; console.log((await pushIdentity()).public_key); await closeDatabase();')
[[ "$push_key_after" == "$push_key_before" ]]
pinned=$(sed -n 's/^CARDSHELF_IMAGE=//p' .env)
[[ "$pinned" == "$repository@sha256:"* ]]
[[ $(sed -n 's/^APP_VERSION=//p' .env) == "$version" ]]
[[ $(stat -c %a .env) == 600 ]]
[[ $(sh scripts/compose.sh ps -q db) == "$before_db" ]]
for service in app worker; do
  container=$(sh scripts/compose.sh ps -q "$service")
  [[ $(docker inspect --format '{{.State.Health.Status}}' "$container") == healthy ]]
  [[ $(docker inspect --format '{{.Config.Image}}' "$container") == "$pinned" ]]
done
backup=$(find backups -name '*.dump' -type f -print -quit)
[[ -s "$backup" ]]
sh scripts/compose.sh exec -T db pg_restore --list < "$backup" > /dev/null
endpoint=$(sh scripts/compose.sh port app 3000)
curl --fail --silent --show-error "http://$endpoint/api/health"
printf '\nImage passed native dependency, startup, backup, contract and pinned upgrade checks.\n'

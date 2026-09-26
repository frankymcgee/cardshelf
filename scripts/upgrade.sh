#!/bin/sh
# Pull a tested release while the site runs, then back up, migrate and restart.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
[ -f .env ] || { echo 'No .env found. Use configure.sh for a first installation.' >&2; exit 1; }
umask 077
exec 9>.cardshelf-upgrade.lock
flock -n 9 || { echo 'Another CardShelf upgrade is already running.' >&2; exit 1; }
TARGET=${1:-stable}
[ "$#" -le 1 ] || { echo 'Usage: sh scripts/upgrade.sh [stable|VERSION|--build]' >&2; exit 1; }
valid_version() {
  case "$1" in ''|*[!0-9.]*) return 1 ;; esac
  printf '%s' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'
}
CONTRACT=$(sh scripts/deployment-contract.sh)
REPOSITORY=${CARDSHELF_IMAGE_REPOSITORY:-ghcr.io/frankymcgee/cardshelf}
if [ "$TARGET" = --build ]; then
  VERSION=$(sed -n 's/.*"version": *"\([0-9][0-9.]*\)".*/\1/p' package.json | head -n 1)
  valid_version "$VERSION" || { echo 'Invalid source version.' >&2; exit 1; }
  IMAGE="cardshelf:$VERSION"
  printf 'Building CardShelf %s from local source while the site stays online.\n' "$VERSION"
  docker build --target runtime --build-arg "APP_VERSION=$VERSION" \
    --build-arg "DEPLOYMENT_CONTRACT=$CONTRACT" --tag "$IMAGE" .
else
  [ "$TARGET" = stable ] || valid_version "$TARGET" || {
    echo 'Usage: sh scripts/upgrade.sh [stable|VERSION|--build]' >&2; exit 1;
  }
  IMAGE="$REPOSITORY:$TARGET"
  printf 'Pulling %s while the site stays online.\n' "$IMAGE"
  if ! docker pull "$IMAGE"; then
    echo 'Image pull failed; the running site is unchanged. Check the release workflow and docker login ghcr.io.' >&2
    exit 1
  fi
fi
# Resolve once, so a moving release tag cannot change midway through an upgrade.
IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$IMAGE")
VERSION=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$IMAGE_ID")
IMAGE_CONTRACT=$(docker image inspect --format '{{index .Config.Labels "io.cardshelf.deployment-contract"}}' "$IMAGE_ID")
valid_version "$VERSION" || {
  echo 'Image has no valid CardShelf release version; site unchanged.' >&2; exit 1;
}
if [ "$TARGET" != stable ] && [ "$TARGET" != --build ] && [ "$TARGET" != "$VERSION" ]; then
  echo 'Image version does not match the requested release; site unchanged.' >&2; exit 1
fi
if [ "$CONTRACT" != "$IMAGE_CONTRACT" ]; then
  echo 'This release needs different server deployment files. Update to its reviewed source release (git pull --ff-only origin main for stable), then rerun. Site unchanged.' >&2
  exit 1
fi
if [ "$TARGET" = --build ]; then
  # Local builds have no registry digest; their content-addressed image ID is stable.
  CARDSHELF_IMAGE=$IMAGE_ID
else
  DIGESTS=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$IMAGE_ID")
  CARDSHELF_IMAGE=$(printf '%s\n' "$DIGESTS" | awk -v prefix="$REPOSITORY@sha256:" 'index($0,prefix)==1 { print; exit }')
  DIGEST=${CARDSHELF_IMAGE#"$REPOSITORY@sha256:"}
  [ "${#DIGEST}" -eq 64 ] && printf '%s' "$DIGEST" | grep -Eq '^[a-f0-9]+$' || {
    echo 'Cannot pin the pulled release digest; site unchanged.' >&2; exit 1;
  }
fi
export CARDSHELF_IMAGE APP_VERSION="$VERSION"
# Validate Compose and prepare the private configuration before any interruption.
sh scripts/compose.sh config --quiet
TMP=$(mktemp .env.upgrade.XXXXXX)
trap 'rm -f "$TMP"' EXIT
trap 'exit 1' HUP INT TERM
sed '/^APP_VERSION=/d; /^CARDSHELF_IMAGE=/d' .env > "$TMP"
printf '\nAPP_VERSION=%s\nCARDSHELF_IMAGE=%s\n' "$VERSION" "$CARDSHELF_IMAGE" >> "$TMP"
chown --reference=.env "$TMP"
chmod 600 "$TMP"
sh scripts/backup.sh
sh scripts/compose.sh stop app worker
if ! sh scripts/compose.sh run --rm --no-deps --pull never -T migrate; then
  echo 'Migration failed. App/worker remain stopped; the previous .env and safety backup are retained. Inspect before proceeding.' >&2
  exit 1
fi
mv "$TMP" .env
# Keep PostgreSQL, Caddy and Postal running. Do not pull another tag after migration.
if ! sh scripts/compose.sh up -d --no-build --pull never --no-deps --wait --wait-timeout 180 app worker; then
  echo 'Release migrated but app/worker did not become healthy. The new image remains pinned. Inspect compose logs; do not roll back the image alone after a schema change.' >&2
  exit 1
fi
sh scripts/compose.sh ps -a
printf 'CardShelf %s is healthy and pinned to %s.\n' "$VERSION" "$CARDSHELF_IMAGE"

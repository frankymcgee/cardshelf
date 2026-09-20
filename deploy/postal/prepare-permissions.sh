#!/bin/sh
# The official image runs UID 999. Restrict ownership changes to generated config.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
[ -f deploy/postal/.enabled ] || { echo 'Run scripts/configure-postal.sh first.' >&2; exit 1; }
[ ! -L deploy/postal/config ] && [ -d deploy/postal/config ] || { echo 'Postal config must be a real directory.' >&2; exit 1; }
# Docker access is required; this does not install software or elevate the host shell.
docker run --rm --network none --user 0:0 --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER \
  --volume "$PWD/deploy/postal/config:/config:rw" --entrypoint sh ghcr.io/postalserver/postal:3.3.7 -eu -c '
    for name in postal.yml signing.key signing-public.pem; do
      [ -f "/config/$name" ] && [ ! -L "/config/$name" ] || exit 1
      chown 999:999 "/config/$name"
      chmod 600 "/config/$name"
    done
    chown 999:999 /config
    chmod 700 /config
  '
printf 'Postal configuration is private and readable by the image UID 999.\n'

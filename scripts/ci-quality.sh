#!/usr/bin/env bash
set -euo pipefail

# Only loopback is available to contributed checks. Dependency installation is
# deliberately outside this suite: these checks use Node and local fixtures.
contributor_uid=$(id -u)
contributor_gid=$(id -g)
sudo -n unshare --net -- /bin/bash -euc '
  ip link set lo up
  exec setpriv --reuid="$1" --regid="$2" --clear-groups \
    --bounding-set=-all --inh-caps=-all --ambient-caps=-all \
    env PATH="$3" HOME="$4" COREPACK_ENABLE_NETWORK=0 ASTRO_TELEMETRY_DISABLED=1 \
    /bin/bash -euc "node scripts/check-public-files.mjs
node scripts/check-translations.mjs
node --test --test-concurrency=1 tooling/plugin-dev/*.test.mjs packages/emdash-plugin-seo/scripts/packed-artifact.test.mjs scripts/check-translations.test.mjs scripts/check-public-files.test.mjs"
' ci-quality "$contributor_uid" "$contributor_gid" "$PATH" "$HOME"

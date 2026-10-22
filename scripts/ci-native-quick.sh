#!/usr/bin/env bash
set -euo pipefail

contributor_uid=$(id -u)
contributor_gid=$(id -g)
sudo -n unshare --net -- /bin/bash -euc '
  ip link set lo up
  exec setpriv --reuid="$1" --regid="$2" --clear-groups \
    --bounding-set=-all --inh-caps=-all --ambient-caps=-all \
    env PATH="$3" HOME="$4" COREPACK_ENABLE_NETWORK=0 ASTRO_TELEMETRY_DISABLED=1 \
    /bin/bash -euc "pnpm verify:quick --target native-1.3.0"
' ci-native-quick "$contributor_uid" "$contributor_gid" "$PATH" "$HOME"

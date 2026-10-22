#!/usr/bin/env bash
set -euo pipefail

contributor_uid=$(id -u)
contributor_gid=$(id -g)
sudo -n unshare --net -- /bin/bash -euc '
  ip link set lo up
  exec setpriv --reuid="$1" --regid="$2" --clear-groups \
    --bounding-set=-all --inh-caps=-all --ambient-caps=-all \
    env PATH="$3" HOME="$4" COREPACK_ENABLE_NETWORK=0 ASTRO_TELEMETRY_DISABLED=1 pnpm_config_verify_deps_before_run=warn \
    /bin/bash -euc "pnpm verify:quick"
' ci-native-quick "$contributor_uid" "$contributor_gid" "$PATH" "$HOME"

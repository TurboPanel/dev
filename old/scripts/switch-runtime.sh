#!/usr/bin/env bash
# Tilt UI button: switch instance runtime and restart affected resources.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dev_root="$(cd "${script_dir}/.." && pwd)"
target="${1:?usage: switch-runtime.sh <workers|deno>}"

node "${script_dir}/signal-runtime-switch.mjs" "${target}"
bash "${script_dir}/sync-env.sh"

cd "${dev_root}"
docker compose \
  -f docker/postgres.compose.yml \
  -f docker/caddy.compose.yml \
  --env-file docker/.env \
  up -d --force-recreate caddy

if command -v tilt >/dev/null 2>&1; then
  tilt trigger env-sync instance daemon 2>/dev/null || true
fi

echo "Switched to ${target} runtime — instance, daemon, and caddy restarted"

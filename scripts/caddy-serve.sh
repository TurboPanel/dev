#!/usr/bin/env bash
# Start Caddy for Tilt dev. Prints a URL Cursor/VS Code can auto-forward from terminal output.
set -euo pipefail

caddyfile="${1:?usage: caddy-serve.sh <Caddyfile>}"
caddy_bin="${HOME}/runtimes/caddy/current/caddy"
port="${CADDY_PORT:-8443}"

if [[ ! -x "${caddy_bin}" ]]; then
  echo "caddy-serve: ${caddy_bin} not found — run instance caddy-install first" >&2
  exit 1
fi

echo "TurboPanel Caddy listening on https://127.0.0.1:${port}"
exec "${caddy_bin}" run --config "${caddyfile}" --adapter caddyfile

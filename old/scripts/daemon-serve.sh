#!/usr/bin/env bash
# Start the co-located daemon for local Tilt dev.
# Workers mode: WSS via Caddy HTTPS. Deno mode: Unix socket beside the instance.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dev_root="$(cd "${script_dir}/.." && pwd)"
install_root="$(cd "${dev_root}/.." && pwd)"
daemon_dir="${install_root}/daemon"
instance_dir="${install_root}/instance"

if [[ -f "${dev_root}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${dev_root}/.env"
  set +a
fi

runtime="${TURBOPANEL_INSTANCE_RUNTIME:-workers}"
caddy_port="${CADDY_PORT:-8443}"
socket_dir="${TURBOPANEL_SOCKET_DIR:-${dev_root}/.run/turbopanel}"
ca_cert="${instance_dir}/certs/ca.crt"

if ! command -v deno >/dev/null 2>&1; then
  echo "daemon-serve: deno is not installed — https://docs.deno.com/runtime/getting_started/installation/" >&2
  exit 1
fi

mkdir -p "${socket_dir}"

# Tilt already manages instance, Postgres, Caddy, and certs — do not run Ansible installs.
export TURBOPANEL_SKIP_ORCHESTRATION=1
unset TURBOPANEL_DEV_INSTANCE

if [[ "${runtime}" == "workers" ]]; then
  if [[ ! -f "${ca_cert}" ]]; then
    echo "daemon-serve: platform CA not found at ${ca_cert} — wait for instance-certs" >&2
    exit 1
  fi

  export TURBOPANEL_INSTANCE_URL="https://localhost:${caddy_port}"
  export TURBOPANEL_INSTANCE_CA="${ca_cert}"
  unset TURBOPANEL_SOCKET TURBOPANEL_SOCKET_DIR
else
  unset TURBOPANEL_INSTANCE_URL TURBOPANEL_INSTANCE_CA
  export TURBOPANEL_SOCKET_DIR="${socket_dir}"
fi

cd "${daemon_dir}"
exec deno run \
  --watch \
  --allow-net \
  --allow-sys=networkInterfaces,hostname \
  --allow-read="${instance_dir}/certs,${socket_dir},${daemon_dir}" \
  --allow-write="${socket_dir},${daemon_dir}" \
  --allow-run \
  --allow-env \
  main.ts

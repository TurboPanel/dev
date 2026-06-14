#!/usr/bin/env bash
# Start the instance in Workers (wrangler) or Deno mode based on dev/.env.
# Deno mode exports TURBOPANEL_DEV_HOST_AUTH=group-only so the install wizard
# verifies sudo/admin group membership without calling pamtester.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dev_root="$(cd "${script_dir}/.." && pwd)"
install_root="$(cd "${dev_root}/.." && pwd)"
instance_dir="${install_root}/instance"

if [[ -f "${dev_root}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${dev_root}/.env"
  set +a
fi

runtime="${TURBOPANEL_INSTANCE_RUNTIME:-workers}"
socket_dir="${TURBOPANEL_SOCKET_DIR:-${dev_root}/.run/turbopanel}"

cd "${instance_dir}"

if [[ "${runtime}" == "deno" ]]; then
  if ! command -v deno >/dev/null 2>&1; then
    echo "instance-serve: deno is not installed — https://docs.deno.com/runtime/getting_started/installation/" >&2
    exit 1
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "instance-serve: node is not installed — required for drizzle-kit (Node.js >= 24; run pnpm install in instance/)" >&2
    exit 1
  fi

  mkdir -p "${socket_dir}"
  export TURBOPANEL_SOCKET_DIR="${socket_dir}"

  # Postgres Unix socket directory (set by sync-env.sh; empty string = fall back to TCP).
  pg_socket_dir="${TURBOPANEL_PG_SOCKET:-}"

  if [[ -f "${instance_dir}/.env" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${instance_dir}/.env"
    set +a
    # Re-read after sourcing .env (may override the defaults above).
    pg_socket_dir="${TURBOPANEL_PG_SOCKET:-${pg_socket_dir}}"
  fi

  # Set after instance/.env so dev env files cannot override the resolved host node.
  node_bin="$(command -v node)"
  export TURBOPANEL_NODE="${node_bin}"

  # Build --allow-net / --allow-read / --allow-write based on connection mode.
  if [[ -n "${pg_socket_dir}" ]]; then
    # Unix socket mode: no TCP needed; allow read+write on the socket directory.
    # 4983: drizzle-kit studio readiness probe (waitForStudioPort).
    allow_net="--allow-net=127.0.0.1:4983"
    allow_read="${socket_dir},${install_root}/daemon,${instance_dir}/certs,${instance_dir}/node_modules,${pg_socket_dir}"
    allow_write="${socket_dir},${pg_socket_dir}"
  else
    # TCP fallback: Postgres + drizzle-kit studio readiness probe.
    allow_net="--allow-net=127.0.0.1:5432,127.0.0.1:4983"
    allow_read="${socket_dir},${install_root}/daemon,${instance_dir}/certs,${instance_dir}/node_modules"
    allow_write="${socket_dir}"
  fi

  allow_run="git,systemctl,sudo,/bin/sh,/usr/bin/sudo,${node_bin}"

  # Dev install wizard: skip PAM password verification, keep group-membership check.
  export TURBOPANEL_DEV_HOST_AUTH=group-only

  exec deno run \
    --allow-env \
    --allow-sys=networkInterfaces \
    --allow-read="${allow_read}" \
    --allow-write="${allow_write}" \
    --allow-run="${allow_run}" \
    ${allow_net} \
    src/deno.ts
fi

exec bash "${script_dir}/ensure-pnpm.sh" dev

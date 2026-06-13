#!/usr/bin/env bash
# Start the Deno mailer for local Tilt dev (Deno instance runtime only).
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

if [[ -f "${instance_dir}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${instance_dir}/.env"
  set +a
fi

amqp_port="${RABBITMQ_AMQP_PORT:-19828}"

wait_for_port() {
  local port="$1"
  local max="${2:-90}"
  for ((i = 1; i <= max; i++)); do
    if (echo >/dev/tcp/127.0.0.1/"$port") 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "mailer-serve: timed out waiting for RabbitMQ on 127.0.0.1:${port}" >&2
  return 1
}

if ! command -v deno >/dev/null 2>&1; then
  echo "mailer-serve: deno is not installed — https://docs.deno.com/runtime/getting_started/installation/" >&2
  exit 1
fi

wait_for_port "$amqp_port"

allow_read="${instance_dir}"
pg_socket="${TURBOPANEL_PG_SOCKET:-}"
if [[ -n "$pg_socket" ]]; then
  allow_read="${allow_read},${pg_socket}"
fi

cd "${instance_dir}"
exec deno run \
  --allow-net \
  --allow-env \
  --allow-read="${allow_read}" \
  mailer/main.ts

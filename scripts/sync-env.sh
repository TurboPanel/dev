#!/usr/bin/env bash
# Read dev/.env and write derived env files into sibling repos for local Tilt dev.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dev_root="$(cd "${script_dir}/.." && pwd)"
install_root="$(cd "${dev_root}/.." && pwd)"

env_file="${dev_root}/.env"
if [[ ! -f "${env_file}" ]]; then
  echo "sync-env: ${env_file} not found — copy .env.example to .env first" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "${env_file}"
set +a

: "${SESSION_SECRET:?SESSION_SECRET is required in dev/.env}"
: "${INSTANCE_DEV_PORT:=18787}"
: "${POSTGRES_USER:?POSTGRES_USER is required in dev/.env}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required in dev/.env}"
: "${POSTGRES_DB:?POSTGRES_DB is required in dev/.env}"
: "${POSTGRES_HOST:=127.0.0.1}"
: "${POSTGRES_PORT:=5432}"
: "${CADDY_PORT:=8443}"
: "${TURBOPANEL_UI_MODE:=dev}"
: "${EXPO_PORT:=8081}"
: "${TURBOPANEL_TLS_EXTRA_SANS:=}"

instance_dir="${install_root}/instance"
if [[ ! -d "${instance_dir}" ]]; then
  echo "sync-env: instance checkout not found at ${instance_dir}" >&2
  exit 1
fi

database_url="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"

write_file() {
  local path="$1"
  shift
  mkdir -p "$(dirname "${path}")"
  printf '%s\n' "$@" >"${path}"
}

write_file "${instance_dir}/.dev.vars" \
  "SESSION_SECRET = \"${SESSION_SECRET}\""

write_file "${instance_dir}/.env" \
  "TURBOPANEL_TLS_EXTRA_SANS=${TURBOPANEL_TLS_EXTRA_SANS}"

write_file "${dev_root}/docker/.env" \
  "POSTGRES_USER=${POSTGRES_USER}" \
  "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}" \
  "POSTGRES_DB=${POSTGRES_DB}" \
  "POSTGRES_PORT=${POSTGRES_PORT}"

echo "sync-env: wrote instance/.dev.vars, instance/.env, docker/.env"
echo "sync-env: DATABASE_URL=${database_url}"

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

if [[ -z "${SESSION_SECRET:-}" && -z "${SESSION_SECRETS:-}" ]]; then
  echo "sync-env: SESSION_SECRET or SESSION_SECRETS is required in dev/.env" >&2
  exit 1
fi
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
ui_dir="${install_root}/ui"
if [[ ! -d "${instance_dir}" ]]; then
  echo "sync-env: instance checkout not found at ${instance_dir}" >&2
  exit 1
fi

mkdir -p "${ui_dir}/dist"

default_database_url="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
default_hyperdrive_url="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"

# Migrations / Drizzle / sync.sh — may differ from the Hyperdrive runtime user in production.
TURBOPANEL_DATABASE_URL="${TURBOPANEL_DATABASE_URL:-${default_database_url}}"

# wrangler dev local Hyperdrive — see https://developers.cloudflare.com/hyperdrive/configuration/local-development/
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="${CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:-${default_hyperdrive_url}}"

write_file() {
  local path="$1"
  shift
  mkdir -p "$(dirname "${path}")"
  printf '%s\n' "$@" >"${path}"
}

write_file "${instance_dir}/.dev.vars" \
  "SESSION_SECRET = \"${SESSION_SECRET:-}\"" \
  "SESSION_SECRETS = \"${SESSION_SECRETS:-}\""

write_file "${instance_dir}/.env" \
  "TURBOPANEL_TLS_EXTRA_SANS=${TURBOPANEL_TLS_EXTRA_SANS}" \
  "TURBOPANEL_DATABASE_URL=${TURBOPANEL_DATABASE_URL}" \
  "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=${CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE}"

write_file "${dev_root}/docker/.env" \
  "POSTGRES_USER=${POSTGRES_USER}" \
  "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}" \
  "POSTGRES_DB=${POSTGRES_DB}" \
  "POSTGRES_PORT=${POSTGRES_PORT}" \
  "CADDY_PORT=${CADDY_PORT}" \
  "INSTANCE_DEV_PORT=${INSTANCE_DEV_PORT}" \
  "EXPO_PORT=${EXPO_PORT}" \
  "TURBOPANEL_UI_MODE=${TURBOPANEL_UI_MODE}"

echo "sync-env: wrote instance/.dev.vars, instance/.env, docker/.env"
echo "sync-env: wrote TURBOPANEL_DATABASE_URL and CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE to instance/.env"

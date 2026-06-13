#!/usr/bin/env bash
# Read dev/.env and write derived env files into sibling repos for local Tilt dev.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dev_root="$(cd "${script_dir}/.." && pwd)"
install_root="$(cd "${dev_root}/.." && pwd)"

node "${script_dir}/init-env.mjs"

env_file="${dev_root}/.env"

# shellcheck disable=SC1090
set -a
source "${env_file}"
set +a

: "${INSTANCE_DEV_PORT:=18787}"
: "${POSTGRES_USER:=turbopanel}"
: "${POSTGRES_PASSWORD:=turbopanel-dev}"
: "${POSTGRES_DB:=turbopanel}"
: "${POSTGRES_HOST:=127.0.0.1}"
: "${POSTGRES_PORT:=5432}"
: "${CADDY_PORT:=8443}"
: "${TURBOPANEL_UI_MODE:=dev}"
: "${EXPO_PORT:=8081}"
: "${WEBSITE_PORT:=19820}"
: "${MAILPIT_SMTP_PORT:=19825}"
: "${MAILPIT_WEB_PORT:=19826}"
: "${RABBITMQ_AMQP_PORT:=19828}"
: "${RABBITMQ_MGMT_PORT:=19833}"
: "${TURBOPANEL_AMQP_URL:=amqp://guest:guest@localhost:${RABBITMQ_AMQP_PORT}}"
: "${TURBOPANEL_SYSTEM_EMAIL_FROM:=noreply@turbopanel.local}"
: "${TURBOPANEL_BASE_URL:=}"
: "${TURBOPANEL_TLS_EXTRA_SANS:=}"
: "${TURBOPANEL_IS_SIGNUP_ENABLED:=1}"
: "${TURBOPANEL_INSTANCE_RUNTIME:=workers}"
: "${TURBOPANEL_SOCKET_DIR:=${dev_root}/.run/turbopanel}"

case "${TURBOPANEL_INSTANCE_RUNTIME}" in
  workers | deno) ;;
  *)
    echo "sync-env: TURBOPANEL_INSTANCE_RUNTIME must be workers or deno (got ${TURBOPANEL_INSTANCE_RUNTIME})" >&2
    exit 1
    ;;
esac

_socket_path="${TURBOPANEL_SOCKET_DIR%/}/instance.sock"
TURBOPANEL_SOCKET_DIAL="${_socket_path#/}"
# Docker Caddy mounts dev/.run/turbopanel at /run/turbopanel-dev (see caddy.compose.yml).
CADDY_SOCKET_DIAL="run/turbopanel-dev/instance.sock"

TURBOPANEL_CORS_ORIGINS="${TURBOPANEL_CORS_ORIGINS:-http://localhost:${WEBSITE_PORT},http://127.0.0.1:${WEBSITE_PORT}}"

instance_dir="${install_root}/instance"
ui_dir="${install_root}/ui"
if [[ ! -d "${instance_dir}" ]]; then
  echo "sync-env: instance checkout not found at ${instance_dir}" >&2
  exit 1
fi

mkdir -p "${dev_root}/.postgresql"
mkdir -p "${TURBOPANEL_SOCKET_DIR}"
# Postgres socket directory: bind-mounted into the container at /var/run/postgresql.
# Docker creates and owns this directory; we just ensure the parent exists and
# record the path so Deno can connect via Unix socket instead of TCP.
_pg_socket_dir="${TURBOPANEL_SOCKET_DIR}/postgres"
mkdir -p "${_pg_socket_dir}" 2>/dev/null || true
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
  "TURBOPANEL_SECRET = \"${TURBOPANEL_SECRET:-}\"" \
  "TURBOPANEL_SECRETS = \"${TURBOPANEL_SECRETS:-}\"" \
  "TURBOPANEL_CORS_ORIGINS = \"${TURBOPANEL_CORS_ORIGINS}\"" \
  "TURBOPANEL_IS_SIGNUP_ENABLED = \"${TURBOPANEL_IS_SIGNUP_ENABLED}\"" \
  "MAILPIT_SMTP_PORT = \"${MAILPIT_SMTP_PORT}\"" \
  "MAILPIT_WEB_PORT = \"${MAILPIT_WEB_PORT}\"" \
  "SMTP_HOST = \"localhost\"" \
  "SMTP_PORT = \"${MAILPIT_SMTP_PORT}\"" \
  "TURBOPANEL_MAILGUN_API_KEY = \"${TURBOPANEL_MAILGUN_API_KEY:-}\"" \
  "TURBOPANEL_MAILGUN_DOMAIN = \"${TURBOPANEL_MAILGUN_DOMAIN:-}\"" \
  "TURBOPANEL_SYSTEM_EMAIL_FROM = \"${TURBOPANEL_SYSTEM_EMAIL_FROM}\"" \
  "TURBOPANEL_AMQP_URL = \"${TURBOPANEL_AMQP_URL}\""

write_file "${instance_dir}/.env" \
  "TURBOPANEL_INSTANCE_RUNTIME=${TURBOPANEL_INSTANCE_RUNTIME}" \
  "TURBOPANEL_TLS_EXTRA_SANS=${TURBOPANEL_TLS_EXTRA_SANS}" \
  "TURBOPANEL_DATABASE_URL=${TURBOPANEL_DATABASE_URL}" \
  "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=${CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE}" \
  "TURBOPANEL_SECRET=${TURBOPANEL_SECRET:-}" \
  "TURBOPANEL_SECRETS=${TURBOPANEL_SECRETS:-}" \
  "TURBOPANEL_CORS_ORIGINS=${TURBOPANEL_CORS_ORIGINS}" \
  "TURBOPANEL_IS_SIGNUP_ENABLED=${TURBOPANEL_IS_SIGNUP_ENABLED}" \
  "TURBOPANEL_SOCKET_DIR=${TURBOPANEL_SOCKET_DIR}" \
  "TURBOPANEL_PG_SOCKET=${_pg_socket_dir}" \
  "TURBOPANEL_PG_USER=${POSTGRES_USER}" \
  "TURBOPANEL_PG_PASSWORD=${POSTGRES_PASSWORD}" \
  "TURBOPANEL_PG_DB=${POSTGRES_DB}" \
  "TURBOPANEL_PG_HOST=${POSTGRES_HOST}" \
  "TURBOPANEL_PG_PORT=${POSTGRES_PORT}" \
  "MAILPIT_SMTP_PORT=${MAILPIT_SMTP_PORT}" \
  "MAILPIT_WEB_PORT=${MAILPIT_WEB_PORT}" \
  "SMTP_HOST=localhost" \
  "SMTP_PORT=${MAILPIT_SMTP_PORT}" \
  "TURBOPANEL_AMQP_URL=${TURBOPANEL_AMQP_URL}" \
  "TURBOPANEL_SYSTEM_EMAIL_FROM=${TURBOPANEL_SYSTEM_EMAIL_FROM}" \
  "TURBOPANEL_BASE_URL=${TURBOPANEL_BASE_URL}"

write_file "${dev_root}/docker/.env" \
  "POSTGRES_USER=${POSTGRES_USER}" \
  "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}" \
  "POSTGRES_DB=${POSTGRES_DB}" \
  "POSTGRES_PORT=${POSTGRES_PORT}" \
  "CADDY_PORT=${CADDY_PORT}" \
  "INSTANCE_DEV_PORT=${INSTANCE_DEV_PORT}" \
  "EXPO_PORT=${EXPO_PORT}" \
  "TURBOPANEL_UI_MODE=${TURBOPANEL_UI_MODE}" \
  "TURBOPANEL_INSTANCE_RUNTIME=${TURBOPANEL_INSTANCE_RUNTIME}" \
  "TURBOPANEL_SOCKET_DIAL=${CADDY_SOCKET_DIAL}" \
  "MAILPIT_SMTP_PORT=${MAILPIT_SMTP_PORT}" \
  "MAILPIT_WEB_PORT=${MAILPIT_WEB_PORT}"

echo "sync-env: wrote instance/.dev.vars, instance/.env, docker/.env"
echo "sync-env: wrote TURBOPANEL_DATABASE_URL and CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE to instance/.env"
echo "sync-env: wrote MAILPIT_SMTP_PORT, MAILPIT_WEB_PORT, SMTP_HOST, and SMTP_PORT to instance/.dev.vars and instance/.env"
echo "sync-env: wrote TURBOPANEL_AMQP_URL, TURBOPANEL_SYSTEM_EMAIL_FROM, and TURBOPANEL_BASE_URL to instance/.env and instance/.dev.vars"
echo "sync-env: wrote TURBOPANEL_MAILGUN_*, TURBOPANEL_SYSTEM_EMAIL_FROM to instance/.dev.vars"

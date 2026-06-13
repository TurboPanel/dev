#!/usr/bin/env bash
# Started by Tilt (tilt/mailpit.tiltfile). Mail data lives in Docker named volume
# turbopanel-mailpit-data (mounted at /data) so it survives container stop, rm, and Tilt teardown.
# Stops the container when Tilt tears down this serve process.
set -euo pipefail

SMTP_PORT="${1:?smtp port}"
WEB_PORT="${2:?web port}"
VOLUME_NAME=turbopanel-mailpit-data

cleanup() {
  docker stop turbopanel-mailpit >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker volume create "$VOLUME_NAME" >/dev/null 2>&1 || true

# Recreate container if it predates the named volume (one-time migration).
if docker inspect turbopanel-mailpit >/dev/null 2>&1; then
  if ! docker inspect turbopanel-mailpit --format '{{range .Mounts}}{{.Name}} {{end}}' | grep -qw "$VOLUME_NAME"; then
    docker stop turbopanel-mailpit >/dev/null 2>&1 || true
    docker rm turbopanel-mailpit >/dev/null 2>&1 || true
  fi
fi

if ! docker inspect turbopanel-mailpit >/dev/null 2>&1; then
  docker run -d --name turbopanel-mailpit \
    -v "${VOLUME_NAME}:/data" \
    -e MP_DATABASE=/data/mailpit.db \
    -p "${SMTP_PORT}:1025" \
    -p "${WEB_PORT}:8025" \
    -e MP_MAX_MESSAGES=1000 \
    -e MP_SMTP_AUTH_ACCEPT_ANY=1 \
    -e MP_SMTP_AUTH_ALLOW_INSECURE=1 \
    axllent/mailpit:latest
fi
docker start turbopanel-mailpit 2>/dev/null || true
docker logs -f turbopanel-mailpit

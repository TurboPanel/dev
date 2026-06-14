#!/usr/bin/env bash
# RabbitMQ for local Tilt dev (Deno mailer + instance AMQP queue).
set -euo pipefail

AMQP_PORT="${1:?amqp port}"
MGMT_PORT="${2:?mgmt port}"

cleanup() {
  docker stop turbopanel-rabbitmq >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

wait_for_port() {
  local port="$1"
  local max="${2:-90}"
  for ((i = 1; i <= max; i++)); do
    if (echo >/dev/tcp/127.0.0.1/"$port") 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "rabbitmq-serve: timed out waiting for 127.0.0.1:${port}" >&2
  return 1
}

if ! docker inspect turbopanel-rabbitmq >/dev/null 2>&1; then
  docker run -d --name turbopanel-rabbitmq \
    -p "${AMQP_PORT}:5672" \
    -p "${MGMT_PORT}:15672" \
    rabbitmq:3-management-alpine
fi
docker start turbopanel-rabbitmq 2>/dev/null || true

wait_for_port "$AMQP_PORT"

docker logs -f turbopanel-rabbitmq

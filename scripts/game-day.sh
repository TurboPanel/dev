#!/usr/bin/env sh
# Fault-injection game day: crash a dependency under a running instance and
# check that the stack comes back on its own.
#
# The lean behind this (Road to 0.1.x, chaos-testing-threat-model) asks for
# recovery "without operator intervention". That phrase hides a distinction
# this script exists to make honest:
#
#   * `kill -9` on the container's host PID is a crash. The container exits
#     non-zero, Docker's `unless-stopped` policy fires, and nothing else has
#     to happen. This is what a real OOM or segfault looks like.
#   * `docker kill <name>` is an operator stopping a container. Docker records
#     it as a manual stop and the restart policy does *not* fire — the
#     container stays down until someone runs `docker start`. It is not a
#     crash simulation, and a game day built on it measures the wrong thing.
#   * `docker exec <name> kill -9 1` does nothing at all: PID 1 of a PID
#     namespace ignores SIGKILL sent from inside that namespace.
#
# Phase 1 (`crash`) is the real test. Phase 2 (`operator-stop`, opt-in via
# --include-operator-stop) demonstrates the trap and then repairs it.
#
# Two things this checks that a human eyeballing `docker ps` does not:
#
#   * /api/health is NOT an outage signal. It is a static identity payload
#     (licence, version, commit) and answers 200 with the database gone — a
#     game day on 2026-09-18 found exactly that. The script asserts it stays
#     200 throughout and says so, so nobody points a monitor at it.
#     /api/daemon/v1/readiness is the endpoint that reads the database.
#   * The instance is never restarted. Recovery means its connection pool
#     reconnected by itself; if the check only passed because systemd bounced
#     the unit, that is not recovery, so the unit's start timestamp is
#     compared before and after.
#
# Development guest only, and it refuses to run anywhere else. From the host
# `dev` checkout it re-execs through `vagrant ssh`:
#
#   ./scripts/game-day.sh                      # postgres, crash phase
#   ./scripts/game-day.sh queue                # rabbitmq
#   ./scripts/game-day.sh --include-operator-stop
#   ./scripts/game-day.sh --all
#
# Exits non-zero if the stack does not recover inside the deadline.

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

# shellcheck source=scripts/lib/paths.sh
. "$SCRIPT_DIR/lib/paths.sh"

INSTANCE_SOCKET=/run/turbopanel/instance.sock
INSTANCE_UNIT=turbopanel-instance
HEALTH_PATH=/api/health
READINESS_PATH=/api/daemon/v1/readiness
# Docker's default restart backoff starts at 100ms and doubles; a Postgres
# that has to replay WAL takes longer than the container does to come up.
RECOVERY_DEADLINE_SECONDS=${RECOVERY_DEADLINE_SECONDS:-90}
POLL_INTERVAL_SECONDS=2

DB_CONTAINER=turbopanel-database
QUEUE_CONTAINER=turbopanel-queue

tp_in_guest() {
  [ -x /opt/turbopanel/vendor/node/current/bin/node ]
}

tp_quote() {
  _arg=$1
  printf "'%s'" "$(printf '%s' "$_arg" | sed "s/'/'\\\\''/g")"
}

tp_usage() {
  cat <<'EOF' >&2
Usage: game-day.sh [--include-operator-stop] [--all] [database|queue]...

Crash a dependency under the running dev instance and check that the stack
recovers with no operator action.

  database                 crash the Postgres container (default)
  queue                    crash the RabbitMQ container
  --all                    both, in order
  --include-operator-stop  also run the `docker kill` phase, which documents
                           that a manual stop defeats `unless-stopped`
  RECOVERY_DEADLINE_SECONDS=90   override the recovery deadline
EOF
}

if ! tp_in_guest; then
  if ! command -v vagrant >/dev/null 2>&1; then
    echo "game-day: run inside the Vagrant guest (or install vagrant on the host)." >&2
    echo "  From the host dev checkout: vagrant ssh -c '\$HOME/dev/scripts/game-day.sh'" >&2
    exit 1
  fi
  cd "$REPO_ROOT"
  quoted=
  for arg in "$@"; do
    quoted="$quoted $(tp_quote "$arg")"
  done
  echo "game-day: re-exec inside the Vagrant guest" >&2
  # shellcheck disable=SC2086
  exec vagrant ssh -c "\$HOME/dev/scripts/game-day.sh$quoted"
fi

INCLUDE_OPERATOR_STOP=0
TARGETS=

for arg in "$@"; do
  case "$arg" in
    -h | --help)
      tp_usage
      exit 0
      ;;
    --include-operator-stop)
      INCLUDE_OPERATOR_STOP=1
      ;;
    --all)
      TARGETS="database queue"
      ;;
    database | queue)
      TARGETS="$TARGETS $arg"
      ;;
    *)
      echo "game-day: unknown argument: $arg" >&2
      tp_usage
      exit 2
      ;;
  esac
done

[ -n "$TARGETS" ] || TARGETS=database

# --- guards -----------------------------------------------------------------
#
# This kills a database. It runs against the disposable dev stack and nothing
# else, and every condition below has to hold before a single signal is sent.

# The mode is read from the host's own daemon.env, not from the shell
# environment: an interactive shell on a production control-plane host has
# TURBOPANEL_MODE unset, and a default of "development" would make an unset
# variable an authorization to kill that host's database. Affirmative or
# nothing.
DAEMON_ENV=${DAEMON_ENV:-/etc/turbopanel/daemon.env}
HOST_MODE=$(sed -n 's/^TURBOPANEL_MODE=//p' "$DAEMON_ENV" 2>/dev/null | tr -d '"'"'"'\r' | tail -1)
if [ "$HOST_MODE" != development ]; then
  echo "game-day: this host is not marked development — refusing." >&2
  echo "  $DAEMON_ENV says TURBOPANEL_MODE=${HOST_MODE:-<unset or unreadable>}" >&2
  echo "  It kills a live database; it runs on a dev guest and nowhere else." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "game-day: docker not found — this runs against the dev container stack." >&2
  exit 1
fi

if ! systemctl is-active --quiet "$INSTANCE_UNIT"; then
  echo "game-day: $INSTANCE_UNIT is not running — nothing to fault-inject under." >&2
  exit 1
fi

if [ ! -S "$INSTANCE_SOCKET" ]; then
  echo "game-day: $INSTANCE_SOCKET is missing — is the instance serving?" >&2
  exit 1
fi

# --- probes -----------------------------------------------------------------

say() {
  printf '%s\n' "$*"
}

probe() {
  # probe <path> -> "<status> <body>"
  _path=$1
  # curl already writes 000 for a refused connection; `|| echo` would append
  # a second one and turn "no answer" into the string 000000.
  _status=$(curl -s -o /tmp/game-day-body.$$ -w '%{http_code}' --max-time 5 \
    --unix-socket "$INSTANCE_SOCKET" "http://localhost$_path" 2>/dev/null) || true
  [ -n "$_status" ] || _status=000
  _body=$(cat /tmp/game-day-body.$$ 2>/dev/null || true)
  rm -f /tmp/game-day-body.$$
  printf '%s %s' "$_status" "$_body"
}

instance_started_at() {
  systemctl show "$INSTANCE_UNIT" -p ActiveEnterTimestampMonotonic --value
}

# docker inspect --format templates, named once so the same string is not
# spelled four different ways as this script grows.
RESTART_COUNT_FORMAT='{{.RestartCount}}'
STATE_STATUS_FORMAT='{{.State.Status}}'
STATE_PID_FORMAT='{{.State.Pid}}'

restart_count() {
  _container=$1
  docker inspect -f "$RESTART_COUNT_FORMAT" "$_container"
}

container_state() {
  _container=$1
  docker inspect -f "$RESTART_COUNT_FORMAT $STATE_STATUS_FORMAT" "$_container" \
    2>/dev/null || echo "- absent"
}

require_container() {
  _container=$1
  if [ "$(docker inspect -f "$STATE_STATUS_FORMAT" "$_container" 2>/dev/null || true)" != running ]; then
    echo "game-day: container $_container is not running — bring the dev stack up first." >&2
    exit 1
  fi
}

# Poll until the readiness answer matches the one taken before the fault, or
# the deadline passes. Returns 0 on match.
await_readiness() {
  _want=$1
  _waited=0
  while [ "$_waited" -lt "$RECOVERY_DEADLINE_SECONDS" ]; do
    if [ "$(probe "$READINESS_PATH")" = "$_want" ]; then
      printf '%s' "$_waited"
      return 0
    fi
    sleep "$POLL_INTERVAL_SECONDS"
    _waited=$((_waited + POLL_INTERVAL_SECONDS))
  done
  printf '%s' "$_waited"
  return 1
}

# Wait for readiness to hold the same answer twice in a row, and for that
# answer not to be an outage. Every phase starts from a settled stack: a
# baseline captured mid-recovery makes the next phase compare against a
# degraded answer and "recover" to the wrong thing.
settle() {
  _previous=
  _waited=0
  while [ "$_waited" -lt "$RECOVERY_DEADLINE_SECONDS" ]; do
    _current=$(probe "$READINESS_PATH")
    case "$_current" in
      000*) ;;
      *'"error":"database unavailable"'*) ;;
      *)
        if [ "$_current" = "$_previous" ]; then
          printf '%s' "$_current"
          return 0
        fi
        ;;
    esac
    _previous=$_current
    sleep "$POLL_INTERVAL_SECONDS"
    _waited=$((_waited + POLL_INTERVAL_SECONDS))
  done
  printf '%s' "$_current"
  return 1
}

FAILURES=0

# --- phase 1: a real crash --------------------------------------------------

crash_phase() {
  _container=$1
  _baseline_readiness=$2
  _baseline_health=$3
  require_container "$_container"

  _restarts_before=$(restart_count "$_container")
  _instance_before=$(instance_started_at)
  _pid=$(docker inspect -f "$STATE_PID_FORMAT" "$_container")

  say ""
  say "=== crash: $_container (host pid $_pid) ==="
  say "  baseline readiness : $_baseline_readiness"
  say "  baseline health    : $_baseline_health"
  say "  restart count      : $_restarts_before"

  # SIGKILL on the host PID, not `docker kill`: see the header. The container
  # exits 137 on its own, which is what the restart policy is for.
  sudo kill -9 "$_pid"
  say "  SIGKILL sent"

  # The outage itself is short — often under two seconds — so this is best
  # effort. Seeing it is nice; not seeing it is not a failure, because the
  # thing under test is the recovery, not the width of the window.
  _saw_outage=no
  _i=0
  while [ "$_i" -lt 10 ]; do
    _now=$(probe "$READINESS_PATH")
    if [ "$_now" != "$_baseline_readiness" ]; then
      _saw_outage=yes
      say "  observed the outage: readiness -> $_now"
      break
    fi
    _health_during=$(probe "$HEALTH_PATH")
    case "$_health_during" in
      200*) ;;
      *) say "  note: health answered '$_health_during' during the outage" ;;
    esac
    _i=$((_i + 1))
  done
  [ "$_saw_outage" = yes ] || say "  outage window closed faster than the probe loop"

  if _waited=$(await_readiness "$_baseline_readiness"); then
    say "  recovered after ${_waited}s: readiness back to the baseline answer"
  else
    say "  FAIL: readiness did not return to '$_baseline_readiness' within ${RECOVERY_DEADLINE_SECONDS}s"
    say "        last answer: $(probe "$READINESS_PATH")"
    say "        container:   $(container_state "$_container")"
    FAILURES=$((FAILURES + 1))
    return 0
  fi

  _restarts_after=$(restart_count "$_container")
  if [ "$_restarts_after" -le "$_restarts_before" ]; then
    say "  FAIL: restart count did not advance ($_restarts_before -> $_restarts_after)"
    say "        the container came back some other way, not by policy"
    FAILURES=$((FAILURES + 1))
  else
    say "  restart policy fired: count $_restarts_before -> $_restarts_after"
  fi

  _instance_after=$(instance_started_at)
  if [ "$_instance_after" != "$_instance_before" ]; then
    say "  FAIL: $INSTANCE_UNIT restarted during the run"
    say "        recovery has to be the pool reconnecting, not systemd bouncing the unit"
    FAILURES=$((FAILURES + 1))
  else
    say "  $INSTANCE_UNIT was never restarted — the pool reconnected by itself"
  fi

  _health_after=$(probe "$HEALTH_PATH")
  if [ "$_health_after" = "$_baseline_health" ]; then
    say "  finding (expected): health is unchanged across the whole outage."
    say "    It is a static identity payload and cannot report this. Monitor"
    say "    $READINESS_PATH instead."
  else
    say "  note: health changed across the outage ($_baseline_health -> $_health_after)"
  fi
}

# --- phase 2: an operator stop, which is not a crash ------------------------

operator_stop_phase() {
  _container=$1
  _baseline_readiness=$2
  require_container "$_container"

  say ""
  say "=== operator stop: $_container ==="
  say "  \`docker kill\` is a manual stop. Docker will NOT restart it."

  _restarts_before=$(restart_count "$_container")
  docker kill "$_container" >/dev/null
  sleep 5

  _state=$(container_state "$_container")
  case "$_state" in
    *running*)
      say "  unexpected: $_container is running again ($_state)."
      say "  Docker's behaviour may have changed; re-check the header's claim."
      ;;
    *)
      say "  confirmed: $_container stayed down ($_state) — no policy restart."
      say "  This is why a game day built on \`docker kill\` proves nothing:"
      say "  it measures an operator's intent, not a crash."
      ;;
  esac

  docker start "$_container" >/dev/null
  say "  repaired with \`docker start\` (the operator action a crash does not need)"

  # `docker start` resets RestartCount, so this is not a before/after
  # comparison — it is a note that the counter no longer means what it did.
  _restarts_after=$(restart_count "$_container")
  say "  restart count was $_restarts_before, and \`docker start\` reset it to $_restarts_after"

  # Leave the stack as the crash phase found it, measured against the same
  # baseline rather than against whatever it happens to answer right now.
  if _waited=$(await_readiness "$_baseline_readiness"); then
    say "  stack back to the baseline answer after ${_waited}s"
  else
    say "  FAIL: stack did not return to the baseline within ${RECOVERY_DEADLINE_SECONDS}s after docker start"
    say "        last answer: $(probe "$READINESS_PATH")"
    FAILURES=$((FAILURES + 1))
  fi
}

# --- run --------------------------------------------------------------------

say "game-day: dev guest, deadline ${RECOVERY_DEADLINE_SECONDS}s"

for target in $TARGETS; do
  case "$target" in
    database) container=$DB_CONTAINER ;;
    queue) container=$QUEUE_CONTAINER ;;
    *) continue ;;
  esac

  if ! baseline_readiness=$(settle); then
    say ""
    say "game-day: the stack never settled before touching $container"
    say "  last readiness: $baseline_readiness"
    FAILURES=$((FAILURES + 1))
    continue
  fi
  baseline_health=$(probe "$HEALTH_PATH")

  crash_phase "$container" "$baseline_readiness" "$baseline_health"

  if [ "$INCLUDE_OPERATOR_STOP" -eq 1 ]; then
    if settle >/dev/null; then
      operator_stop_phase "$container" "$baseline_readiness"
    else
      say ""
      say "  skipping the operator-stop phase: the stack has not settled again"
      FAILURES=$((FAILURES + 1))
    fi
  fi
done

say ""
if [ "$FAILURES" -eq 0 ]; then
  say "game-day: PASS — every fault recovered with no operator action."
  exit 0
fi

say "game-day: FAIL — $FAILURES check(s) did not hold."
exit 1

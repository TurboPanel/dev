#!/bin/sh
# new-issues.sh: fail a pull request that adds any SonarCloud issue.
#
#   new-issues.sh <project-key> <pull-request-number>
#
# Owner rule (2026-09-30): a pull request may not add a single Sonar issue.
# SonarCloud's built-in "Sonar way" gate fails only on ratings, so one new
# code smell (a nested ternary, say) still passes it, and custom gates need a
# paid plan. Every repo's verify runs this right after its pull-request scan,
# which already waited for the gate (sonar.qualitygate.wait=true), so the
# analysis is processed by the time this asks for it.
#
# Fails closed: when SonarCloud has no analysis for the pull request, or keeps
# answering with an error, this fails with the reason instead of passing.
#
# Environment:
#   SONAR_TOKEN          optional; sent as a bearer token (public projects read without one)
#   SONAR_HOST_URL       default https://sonarcloud.io
#   SONAR_CURL           default curl (tests swap in a fake)
#   SONAR_ATTEMPTS       default 6
#   SONAR_RETRY_SECONDS  default 10
set -eu

PROJECT="${1:-}"
PR="${2:-}"
HOST="${SONAR_HOST_URL:-https://sonarcloud.io}"
CURL="${SONAR_CURL:-curl}"
ATTEMPTS="${SONAR_ATTEMPTS:-6}"
DELAY="${SONAR_RETRY_SECONDS:-10}"
WORK="$(mktemp -d "${RUNNER_TEMP:-/tmp}/sonar-new-issues.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

fail() {
  reason="$1"
  echo "::error title=No new Sonar issues::$reason" >&2
  exit 1
}

if [ -z "$PROJECT" ] || [ -z "$PR" ]; then
  echo "::error title=No new Sonar issues::usage: new-issues.sh <project-key> <pull-request-number>" >&2
  exit 2
fi
case "$PR" in
  *[!0123456789]*)
    echo "::error title=No new Sonar issues::pull request number must be digits, got: $PR" >&2
    exit 2
    ;;
  *) ;;
esac

DASHBOARD="$HOST/project/issues?id=$PROJECT&pullRequest=$PR&resolved=false"

# get <path-and-query> <output-file>: one GET; prints the HTTP status (000 when
# the request itself failed). The token goes through a curl config on stdin so
# it never appears in the process list.
get() {
  path="$1"
  out="$2"
  code=""
  if [ -n "${SONAR_TOKEN:-}" ]; then
    code="$(printf 'header = "Authorization: Bearer %s"\n' "$SONAR_TOKEN" |
      "$CURL" -sS -K - -o "$out" -w '%{http_code}' "$HOST$path")" || true
  else
    code="$("$CURL" -sS -o "$out" -w '%{http_code}' "$HOST$path" </dev/null)" || true
  fi
  printf '%s' "${code:-000}"
}

# fetch <path-and-query> <output-file> <jq-check>: GET until the answer is a 200
# whose body passes jq-check, retrying SONAR_ATTEMPTS times. Returns 1 after the
# last attempt, leaving the last status in LAST_STATUS.
fetch() {
  path="$1"
  out="$2"
  check="$3"
  attempt=1
  while :; do
    LAST_STATUS="$(get "$path" "$out")"
    if [ "$LAST_STATUS" = 200 ] && jq -e "$check" "$out" >/dev/null 2>&1; then
      return 0
    fi
    if [ "$attempt" -ge "$ATTEMPTS" ]; then
      return 1
    fi
    attempt=$((attempt + 1))
    sleep "$DELAY"
  done
}

fetch "/api/qualitygates/project_status?projectKey=$PROJECT&pullRequest=$PR" \
  "$WORK/status.json" '.projectStatus.status' ||
  fail "SonarCloud has no analysis for $PROJECT pull request $PR (last HTTP status $LAST_STATUS). The Sonar scan must run before this check: $DASHBOARD"

fetch "/api/issues/search?componentKeys=$PROJECT&pullRequest=$PR&resolved=false&ps=100" \
  "$WORK/issues.json" '.total | numbers' ||
  fail "Could not read the Sonar issues for $PROJECT pull request $PR (last HTTP status $LAST_STATUS): $DASHBOARD"

TOTAL="$(jq -r '.total' "$WORK/issues.json")"
if [ "$TOTAL" -eq 0 ]; then
  echo "No new Sonar issues on this pull request ($PROJECT #$PR)."
  exit 0
fi

# One annotation per issue, on its file and line. Workflow-command data escapes
# %, CR and LF; property values also escape : and ,.
jq -r '
  def data: gsub("%"; "%25") | gsub("\r"; "%0D") | gsub("\n"; "%0A");
  def prop: data | gsub(":"; "%3A") | gsub(","; "%2C");
  .issues[]
  | (.component | sub("^[^:]*:"; "")) as $file
  | (.severity // (.impacts[0].severity // "?")) as $sev
  | "::error file=\($file | prop)"
    + (if .line then ",line=\(.line)" else "" end)
    + ",title=\("Sonar " + .rule + " (" + $sev + ")" | prop)::\(.message | data)"
' "$WORK/issues.json" >&2

SHOWN="$(jq -r '.issues | length' "$WORK/issues.json")"
if [ "$TOTAL" -gt "$SHOWN" ]; then
  echo "...and $((TOTAL - SHOWN)) more; see the dashboard." >&2
fi
fail "$TOTAL new Sonar issue(s) on this pull request. Fix them (never NOSONAR): $DASHBOARD"

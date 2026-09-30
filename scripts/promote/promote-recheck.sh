#!/bin/sh
# promote-recheck: re-run the promote-ok check of the open promotion PRs.
#
# promote-ok (promote-ok.sh) is red while what a promotion PR would publish
# does not exist yet: the canary of the RC PR's head commit, or the rc a
# Release PR releases. When something that could change that finishes (the
# trunk CI, the canary, Publish Release Candidate), the caller runs this
# script, which re-runs the failed promote-ok run of the current head of
# each open PR:
#
#   trunk   -> staging   "Release Candidate x.y.z-rc.N"
#   staging -> live      "Release x.y.z"
#
# A re-run keeps the check on the same head commit, under the same name and
# the same app (GitHub Actions), so a ruleset that requires it sees the new
# result. A run still in progress is waited for (it may have started before
# the missing piece appeared) and then re-run if it failed.
#
# Best effort: it never fails its own run. Anything it cannot do is reported
# as a warning; re-running the failed check by hand does the same thing.
#
# Environment:
#   REPO           owner/name
#   WORKFLOW       the caller's check workflow file (promote-ok.yml)
#   DRY_RUN        true: report what would be re-run, change nothing
#   WAIT_POLLS     how many times to look at an in-progress run (default 12)
#   POLL_SECONDS   pause between looks (default 10)
set -u

WAIT_POLLS="${WAIT_POLLS:-12}"
POLL_SECONDS="${POLL_SECONDS:-10}"
DRY_RUN="${DRY_RUN:-false}"

warn() {
  _msg="$1"
  echo "::warning title=promote-ok recheck::$_msg" >&2
  return 0
}

# "<number> <head sha>" of the open PR base <- head, or nothing.
open_pr() {
  _base="$1"
  _head="$2"
  gh pr list --repo "$REPO" --base "$_base" --head "$_head" --state open \
    --json number,headRefOid --jq '.[0] | select(. != null) | "\(.number) \(.headRefOid)"' 2>/dev/null
  return 0
}

# "<run id> <status> <conclusion>" of the newest check run for a head, or nothing.
latest_run() {
  _sha="$1"
  gh run list --repo "$REPO" --workflow "$WORKFLOW" --event pull_request --commit "$_sha" --limit 1 \
    --json databaseId,status,conclusion --jq '.[0] | select(. != null) | "\(.databaseId) \(.status) \(.conclusion)"' 2>/dev/null
  return 0
}

# The newest run once it has finished (or as it stands after WAIT_POLLS looks).
settled_run() {
  _sha="$1"
  _polls=0
  _run="$(latest_run "$_sha")"
  while [ -n "$_run" ] && [ "$(echo "$_run" | cut -d' ' -f2)" != "completed" ] && [ "$_polls" -lt "$WAIT_POLLS" ]; do
    sleep "$POLL_SECONDS"
    _polls=$((_polls + 1))
    _run="$(latest_run "$_sha")"
  done
  printf '%s\n' "$_run"
  return 0
}

rerun() {
  _label="$1"
  _id="$2"
  if [ "$DRY_RUN" = "true" ]; then
    echo "$_label: would re-run the failed promote-ok run $_id (dry run)"
    return 0
  fi
  if gh run rerun "$_id" --repo "$REPO" --failed >/dev/null 2>&1; then
    echo "$_label: re-ran the failed promote-ok run $_id"
  else
    warn "$_label: could not re-run promote-ok run $_id — re-run its failed jobs by hand"
  fi
  return 0
}

recheck() {
  _base="$1"
  _head="$2"
  _pr="$(open_pr "$_base" "$_head")"
  if [ -z "$_pr" ]; then
    echo "$_head -> $_base: no open PR"
    return 0
  fi
  _label="PR #${_pr%% *}"
  _sha="${_pr#* }"
  _run="$(settled_run "$_sha")"
  if [ -z "$_run" ]; then
    warn "$_label: no promote-ok run for its head $_sha yet (the PR predates promote-ok.yml?) — push to it, or close and reopen it, to start one"
    return 0
  fi
  _id="$(echo "$_run" | cut -d' ' -f1)"
  _status="$(echo "$_run" | cut -d' ' -f2)"
  _conclusion="$(echo "$_run" | cut -d' ' -f3)"
  case "$_status:$_conclusion" in
    completed:success) echo "$_label: promote-ok is already green on $_sha" ;;
    completed:*) rerun "$_label" "$_id" ;;
    *) warn "$_label: promote-ok run $_id is still '$_status' after waiting — it reports on its own when it ends" ;;
  esac
  return 0
}

if [ -z "${REPO:-}" ] || [ -z "${WORKFLOW:-}" ]; then
  warn "promote-recheck needs REPO and WORKFLOW"
  exit 0
fi
recheck staging trunk
recheck live staging
exit 0

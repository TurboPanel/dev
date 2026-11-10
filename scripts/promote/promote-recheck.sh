#!/bin/sh
# promote-recheck: look again at the promote-ok check of the open promotion PRs.
#
# promote-ok (promote-ok.sh, reported by promote-ok-report.sh) stays pending
# while what a promotion PR would publish does not exist yet: the canary of
# the RC PR's head commit, or the rc a Release PR releases. When something
# that could change that finishes (the trunk CI, the canary, Publish Release
# Candidate), the caller runs this script, which judges the current head of
# each open PR again and writes the verdict to its `promote-ok` check run:
#
#   trunk   -> staging   "Release Candidate x.y.z-rc.N"
#   staging -> live      "Release x.y.z"
#
# and then the commit that finished building ("the trigger commit") when it
# is no longer any PR's head. A trunk commit was the RC PR's head until the
# next merge moved the PR on; its promote-ok check stays on that commit. It
# turns green when its canary exists, and is otherwise closed as neutral
# ("superseded"): no PR can merge it any more, so it must not stay pending
# (or red) for good. Neutral is written only once both PR lists were read and
# the commit is neither PR's head.
#
# Nothing is re-run and nothing waits: each look takes seconds. The caller
# queues rechecks one at a time; a look that finishes after a newer one never
# turns a green check back to pending (promote-ok-report.sh).
#
# Environment:
#   REPO           owner/name
#   REPO_KIND, CI_WORKFLOW  as for promote-ok.sh
#   DRY_RUN        true: report what would be written, change nothing
#   DETAILS_URL    optional; this run, linked from the check
#   TRIGGER_SHA    the head commit of the run that triggered the recheck
#                  (empty for a manual run)
#   TRIGGER_EVENT  that run's event; for a workflow_run-started run (the
#                  canary) TRIGGER_SHA is the branch tip, not what it built,
#                  so the commit is read from TRIGGER_TITLE instead
#   TRIGGER_TITLE  that run's title ("Canary <commit>" names what it built)
#   CHECK_APP_ID   optional; the app whose check runs count (default 15368)
set -u

HERE="$(dirname "$0")"
DRY_RUN="${DRY_RUN:-false}"
APP_ID="${CHECK_APP_ID:-15368}"
FAILED=0
LISTED=1
HEADS=""

warn() {
  echo "::warning title=promote-ok recheck::$1" >&2
  return 0
}

# A verdict that could not be written: the check may now be stale, so fail
# the run and let a person look.
error() {
  echo "::error title=promote-ok recheck::$1" >&2
  FAILED=1
  return 0
}

# "<number> <head sha>" of the open PR base <- head, nothing when there is
# none; fails when the PRs cannot be listed.
open_pr() {
  gh pr list --repo "$REPO" --base "$1" --head "$2" --state open \
    --json number,headRefOid --jq '.[0] | select(. != null) | "\(.number) \(.headRefOid)"' 2>/dev/null || return 1
  return 0
}

# Judge $2 for base $1 and write the verdict ($3, when set, replaces a
# verdict that is not pass: "superseded").
judge() {
  _base="$1"
  _sha="$2"
  _instead="${3:-}"
  _file="$(mktemp)"
  BASE="$_base" HEAD_SHA="$_sha" VERDICT_FILE="$_file" GITHUB_STEP_SUMMARY="" \
    sh "$HERE/promote-ok.sh" >/dev/null 2>&1
  _verdict=""
  if [ -n "$_instead" ] && ! grep -qx 'verdict=pass' "$_file"; then
    _verdict="$_instead"
  fi
  if ! VERDICT="$_verdict" BASE="$_base" HEAD_SHA="$_sha" VERDICT_FILE="$_file" \
    sh "$HERE/promote-ok-report.sh"; then
    error "could not write the promote-ok check of $_sha ($_base) — re-run this recheck"
  fi
  rm -f "$_file"
  return 0
}

recheck() {
  _base="$1"
  _head="$2"
  if ! _pr="$(open_pr "$_base" "$_head")"; then
    LISTED=0
    warn "$_head -> $_base: could not list the open PRs — re-run this recheck"
    return 0
  fi
  if [ -z "$_pr" ]; then
    echo "$_head -> $_base: no open PR"
    return 0
  fi
  _sha="${_pr#* }"
  HEADS="$HEADS $_sha"
  echo "PR #${_pr%% *} ($_head -> $_base): head $_sha"
  judge "$_base" "$_sha"
  return 0
}

# The commit the triggering run was for: its head commit, or for a run started
# by another run (the canary) the commit its title names. Nothing when there
# is no trigger (a manual run) or the title names none.
trigger_commit() {
  if [ "${TRIGGER_EVENT:-}" = "workflow_run" ]; then
    printf '%s\n' "${TRIGGER_TITLE:-}" | tr -s ' \t' '\n\n' | grep -xE '[0-9a-f]{40}' | head -n 1
  else
    printf '%s\n' "${TRIGGER_SHA:-}" | grep -xE '[0-9a-f]{40}'
  fi
  return 0
}

# The trigger commit, when it is no longer an open PR's head and its newest
# promote-ok check (ours) is still open or red: green if what it waited for
# now exists, otherwise closed as superseded. A commit that never had our
# check (it was never a promotion PR's head) is left alone.
recheck_superseded() {
  _sha="$(trigger_commit)"
  if [ -z "$_sha" ]; then
    [ -z "${TRIGGER_EVENT:-}" ] || echo "trigger: names no commit, so no earlier head to look at"
    return 0
  fi
  case " $HEADS " in
    *" $_sha "*)
      echo "trigger $_sha: is an open PR's head, looked at above"
      return 0
      ;;
  esac
  if [ "$LISTED" != 1 ]; then
    warn "trigger $_sha: the open PRs could not be listed, so it is not closed as superseded"
    return 0
  fi
  _latest="$(gh api "repos/$REPO/commits/$_sha/check-runs?check_name=promote-ok&filter=all&per_page=100" \
    --jq "[.check_runs[] | select(.app.id == $APP_ID)] | sort_by(.id) | last
          | if . == null then \"none\" else \"\\(.status) \\(.conclusion // \"-\") \\(.external_id // \"-\")\" end" 2>/dev/null)" || {
    warn "trigger $_sha: could not read its promote-ok check"
    return 0
  }
  read -r _status _conclusion _ext <<EOF
$_latest
EOF
  case "$_ext" in
    promote-ok:staging | promote-ok:live) ;;
    *)
      echo "trigger $_sha: has no promote-ok check of this kind (never a promotion PR's head)"
      return 0
      ;;
  esac
  case "$_status:$_conclusion" in
    completed:success | completed:neutral)
      echo "trigger $_sha: promote-ok is already $_conclusion"
      return 0
      ;;
  esac
  echo "trigger $_sha: no longer a promotion PR's head; promote-ok is $_status ($_conclusion)"
  judge "${_ext#promote-ok:}" "$_sha" superseded
  return 0
}

if [ -z "${REPO:-}" ] || [ -z "${REPO_KIND:-}" ] || [ -z "${CI_WORKFLOW:-}" ]; then
  warn "promote-recheck needs REPO, REPO_KIND and CI_WORKFLOW"
  exit 0
fi
export REPO REPO_KIND CI_WORKFLOW DRY_RUN
recheck staging trunk
recheck live staging
recheck_superseded
exit "$FAILED"

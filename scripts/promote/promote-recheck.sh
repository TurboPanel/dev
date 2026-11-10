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
# and then of the commit that finished build ("the trigger commit") when it is
# no longer any PR's head. A trunk commit was the RC PR's head until the next
# merge moved the PR on; its promote-ok check stays on that commit, and the
# canary that turns it green finishes after the PR has moved, so without this
# the commit keeps a red check for good. Each one only re-runs an existing
# pull_request run of the caller's promote-ok workflow; it never reports a
# check itself, so a re-run that passes is promote-ok's own verdict.
#
# A re-run keeps the check on the same head commit, under the same name and
# the same app (GitHub Actions), so a ruleset that requires it sees the new
# result. A run still in progress is waited for (it may have started before
# the missing piece appeared) and then re-run if it did not pass. promote-ok
# looks once and ends in seconds, so a run still going after that wait is
# waiting for a runner. What happens then depends on its jobs (see restart):
# an evaluate job that has not started looks on its own and is left; one
# still running is waited for (its own limit is 5 minutes); one that failed,
# whose promote-ok fan-in job is visibly queued for a runner, is
# force-cancelled and re-run. A run is never cancelled before its promote-ok
# job is queued: a force-cancel ends jobs that were never queued as skipped,
# and a skipped promote-ok reads as passing. A re-run is the whole run (it is
# two short jobs), which also restarts a cancelled one.
#
# Best effort until it cancels something: anything it cannot read or do is a
# warning, and re-running the failed check by hand does the same thing. Once
# it has force-cancelled a run, a run that does not end or a re-run that is
# refused fails this step (::error), since that check now needs a person.
#
# Worst case per commit: WAIT_POLLS + EVAL_POLLS + CANCEL_POLLS pauses of
# POLL_SECONDS (42 x 10 s with the defaults), for at most three commits. The
# caller's timeout-minutes (gh-promote-ok-recheck.yml) allows for that with
# room for the API calls; src/lib/promote-ok-script.test.ts ties the two.
#
# Environment:
#   REPO           owner/name
#   WORKFLOW       the caller's check workflow file (promote-ok.yml)
#   DRY_RUN        true: report what would be re-run, change nothing
#   TRIGGER_SHA    the head commit of the run that triggered the recheck
#                  (empty for a manual run)
#   TRIGGER_EVENT  that run's event; for a workflow_run-started run (the
#                  canary) TRIGGER_SHA is the branch tip, not what it built,
#                  so the commit is read from TRIGGER_TITLE instead
#   TRIGGER_TITLE  that run's title ("Canary <commit>" names what it built)
#   WAIT_POLLS     how many times to look at an in-progress run (default 6)
#   EVAL_POLLS     how many more times to look at its jobs while the
#                  evaluate job runs, or until a failed one's promote-ok job
#                  is queued (default 33: past evaluate's 5-minute limit)
#   CANCEL_POLLS   how many times to look at a run after force-cancelling it
#                  (default 3; a force-cancel ends a run in seconds)
#   POLL_SECONDS   pause between looks (default 10)
set -u

WAIT_POLLS="${WAIT_POLLS:-6}"
EVAL_POLLS="${EVAL_POLLS:-33}"
CANCEL_POLLS="${CANCEL_POLLS:-3}"
POLL_SECONDS="${POLL_SECONDS:-10}"
DRY_RUN="${DRY_RUN:-false}"
FAILED=0
AFTER_CANCEL=0

warn() {
  _msg="$1"
  echo "::warning title=promote-ok recheck::$_msg" >&2
  return 0
}

# A check this script cancelled and could not restart: fail the step.
error() {
  _msg="$1"
  echo "::error title=promote-ok recheck::$_msg" >&2
  FAILED=1
  return 0
}

# "<number> <head sha>" of the open PR base <- head, nothing when there is
# none; fails when the PRs cannot be listed.
open_pr() {
  _base="$1"
  _head="$2"
  gh pr list --repo "$REPO" --base "$_base" --head "$_head" --state open \
    --json number,headRefOid --jq '.[0] | select(. != null) | "\(.number) \(.headRefOid)"' 2>/dev/null || return 1
  return 0
}

# "<run id> <status> <conclusion>" of the newest check run for a head,
# nothing when it has none; fails when the runs cannot be listed.
latest_run() {
  _sha="$1"
  gh run list --repo "$REPO" --workflow "$WORKFLOW" --event pull_request --commit "$_sha" --limit 1 \
    --json databaseId,status,conclusion --jq '.[0] | select(. != null) | "\(.databaseId) \(.status) \(.conclusion)"' 2>/dev/null || return 1
  return 0
}

# The newest run once it has finished (or as it stands after $2 more looks);
# fails when a look fails.
settled_run() {
  _sha="$1"
  _max="$2"
  _polls=0
  _run="$(latest_run "$_sha")" || return 1
  while [ -n "$_run" ] && [ "$(echo "$_run" | cut -d' ' -f2)" != "completed" ] && [ "$_polls" -lt "$_max" ]; do
    sleep "$POLL_SECONDS"
    _polls=$((_polls + 1))
    _run="$(latest_run "$_sha")" || return 1
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
  if gh run rerun "$_id" --repo "$REPO" >/dev/null 2>&1; then
    echo "$_label: re-ran the failed promote-ok run $_id"
  elif [ "$AFTER_CANCEL" = 1 ]; then
    error "$_label: force-cancelled promote-ok run $_id but could not re-run it — re-run it by hand now"
  else
    warn "$_label: could not re-run promote-ok run $_id — re-run its failed jobs by hand"
  fi
  return 0
}

# What to do with a head's newest run ("<id> <status> <conclusion>"): nothing
# when it passed, re-run it when it ended any other way. $3 is what to do
# when it is still going.
act() {
  _label="$1"
  _run="$2"
  _still="$3"
  _id="$(echo "$_run" | cut -d' ' -f1)"
  _status="$(echo "$_run" | cut -d' ' -f2)"
  _conclusion="$(echo "$_run" | cut -d' ' -f3)"
  case "$_status:$_conclusion" in
    completed:success) echo "$_label: promote-ok is already green on $_sha" ;;
    completed:*) rerun "$_label" "$_id" ;;
    *) "$_still" "$_label" "$_id" "$_status" ;;
  esac
  return 0
}

# "<evaluate status> <evaluate conclusion> <promote-ok job status>" of a run,
# "none" for a job it does not have yet and "-" for no conclusion; fails
# when the jobs cannot be read.
jobs_state() {
  _id="$1"
  _jq='def state(j): if j == null then "none -" else "\(j.status) \(if (j.conclusion // "") == "" then "-" else j.conclusion end)" end;'
  _jq="$_jq"' [.jobs[] | select(.name | test("evaluate"))][0] as $e | [.jobs[] | select(.name == "promote-ok")][0] as $f'
  _jq="$_jq"' | "\(state($e)) \(state($f) | split(" ")[0])"'
  gh run view "$_id" --repo "$REPO" --json jobs --jq "$_jq" 2>/dev/null || return 1
  return 0
}

# Whether to look at a run's jobs again: its evaluate job is running, or it
# failed and its promote-ok job is not queued yet (or is finishing).
jobs_moving() {
  _st="$1"
  case "$_st" in
    in_progress\ *) return 0 ;;
    "completed success "*) return 1 ;;
    completed\ *\ none | completed\ *\ in_progress | completed\ *\ pending | completed\ *\ requested) return 0 ;;
    *) return 1 ;;
  esac
}

# A run still going after the wait. Its jobs decide what to do:
#   evaluate not started   (none yet, queued, waiting) it looks on its own
#                          once it gets a runner, after the trigger: leave it.
#   evaluate passed        only the fan-in job is left: leave it.
#   evaluate running       it may have looked too early, but cancelling now
#                          would end the never-queued promote-ok job as
#                          skipped (which passes): wait for it to end, up to
#                          EVAL_POLLS looks, then decide as below. Still
#                          running after that: warn, never cancel.
#   evaluate failed        it looked before what it waits for existed.
#     promote-ok queued    (or waiting) force-cancel the run (a plain cancel
#                          still runs the caller's `if: always()` fan-in, so it
#                          would wait for a runner all the same), check that
#                          the job did not end skipped, then re-run it.
#     promote-ok finished  the run has ended: re-run it as usual.
#     promote-ok not yet   (after the wait) warn, never cancel.
restart() {
  _label="$1"
  _id="$2"
  _polls=0
  _st="$(jobs_state "$_id")" || _st=""
  while [ -n "$_st" ] && jobs_moving "$_st" && [ "$_polls" -lt "$EVAL_POLLS" ]; do
    sleep "$POLL_SECONDS"
    _polls=$((_polls + 1))
    _st="$(jobs_state "$_id")" || _st=""
  done
  if [ -z "$_st" ]; then
    warn "$_label: promote-ok run $_id is still going and its jobs could not be read — re-run it by hand if it ends red"
    return 0
  fi
  read -r _e_status _e_conclusion _f_status <<EOF
$_st
EOF
  case "$_e_status:$_e_conclusion" in
    completed:success)
      echo "$_label: promote-ok run $_id has passed its evaluation; it reports green once its last job gets a runner"
      return 0
      ;;
    completed:*) ;;
    in_progress:*)
      warn "$_label: promote-ok run $_id is still evaluating after the wait; it is not cancelled (that would skip its promote-ok job, which reads as passing) — re-run it by hand if it ends red"
      return 0
      ;;
    *)
      echo "$_label: promote-ok run $_id has not evaluated yet ($_e_status); it looks on its own once it gets a runner"
      return 0
      ;;
  esac
  case "$_f_status" in
    queued | waiting) ;;
    completed)
      # It may still read in_progress for a moment after its last job ends.
      _run="$(settled_run "$_sha" "$CANCEL_POLLS")" || _run=""
      if [ -z "$_run" ]; then
        warn "$_label: promote-ok run $_id has ended but could not be read again — re-run it by hand if it is red"
      else
        act "$_label" "$_run" still_going
      fi
      return 0
      ;;
    *)
      warn "$_label: promote-ok run $_id ended its evaluation '$_e_conclusion' but its promote-ok job is not queued yet ($_f_status); it is not cancelled (that would skip the job, which reads as passing) — re-run it by hand once it ends red"
      return 0
      ;;
  esac
  if [ "$DRY_RUN" = "true" ]; then
    echo "$_label: would force-cancel and re-run promote-ok run $_id, which ended its evaluation '$_e_conclusion' (dry run)"
    return 0
  fi
  echo "$_label: promote-ok run $_id ended its evaluation '$_e_conclusion' and its promote-ok job is $_f_status; force-cancelling it to re-run it"
  # A cancel that fails is usually a run that just ended; the look below says.
  gh api -X POST "repos/$REPO/actions/runs/$_id/force-cancel" >/dev/null 2>&1 || true
  AFTER_CANCEL=1
  if _run="$(settled_run "$_sha" "$CANCEL_POLLS")" && [ -n "$_run" ]; then
    check_not_skipped "$_label" "$_id"
    act "$_label" "$_run" gave_up
  else
    error "$_label: force-cancelled promote-ok run $_id but could not read it again — re-run it by hand now"
  fi
  AFTER_CANCEL=0
  return 0
}

# After a force-cancel: a promote-ok job that ended skipped reads as passing
# until the re-run replaces it, so say so loudly. It should not happen (the
# run is only cancelled once that job is queued), which is why it is an error.
check_not_skipped() {
  _label="$1"
  _id="$2"
  _fan="$(gh run view "$_id" --repo "$REPO" --json jobs \
    --jq '[.jobs[] | select(.name == "promote-ok")][0] | if . == null then "none" else (.conclusion // "-") end' 2>/dev/null)" || _fan="unreadable"
  case "$_fan" in
    skipped) error "$_label: force-cancelled promote-ok run $_id ended its promote-ok job skipped, which reads as passing — check that the re-run below replaced it" ;;
    unreadable) warn "$_label: could not read the jobs of force-cancelled promote-ok run $_id to check that its promote-ok job did not end skipped" ;;
    *) ;;
  esac
  return 0
}

still_going() {
  _label="$1"
  _id="$2"
  _status="$3"
  warn "$_label: promote-ok run $_id is '$_status' again — re-run it by hand if it ends red"
  return 0
}

gave_up() {
  _label="$1"
  _id="$2"
  _status="$3"
  error "$_label: promote-ok run $_id is still '$_status' after it was force-cancelled and waited for — re-run it by hand once it ends"
  return 0
}

recheck() {
  _base="$1"
  _head="$2"
  if ! _pr="$(open_pr "$_base" "$_head")"; then
    warn "$_head -> $_base: could not list the open PRs — re-run this recheck, or the PR's failed check, by hand"
    return 0
  fi
  if [ -z "$_pr" ]; then
    echo "$_head -> $_base: no open PR"
    return 0
  fi
  _label="PR #${_pr%% *}"
  _sha="${_pr#* }"
  HEADS="$HEADS $_sha"
  if ! _run="$(settled_run "$_sha" "$WAIT_POLLS")"; then
    warn "$_label: could not list the promote-ok runs of its head $_sha — re-run its failed check by hand"
    return 0
  fi
  if [ -z "$_run" ]; then
    warn "$_label: no promote-ok run for its head $_sha yet (the PR predates promote-ok.yml?) — push to it, or close and reopen it, to start one"
    return 0
  fi
  act "$_label" "$_run" restart
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

# The trigger commit's newest promote-ok run, when that commit is no longer
# any open PR's head (the heads were handled above). A commit that never had
# a promote-ok run (it was never a promotion PR's head) is left quietly.
recheck_superseded() {
  _sha="$(trigger_commit)"
  if [ -z "$_sha" ]; then
    if [ -n "${TRIGGER_EVENT:-}" ]; then
      echo "trigger: names no commit, so no earlier head to re-check"
    fi
    return 0
  fi
  case " $HEADS " in
    *" $_sha "*)
      echo "trigger $_sha: is an open PR's head, re-checked above"
      return 0
      ;;
  esac
  _label="earlier head $(printf '%s' "$_sha" | cut -c1-7)"
  if ! _run="$(settled_run "$_sha" "$WAIT_POLLS")"; then
    warn "$_label: could not list the promote-ok runs of $_sha — re-run its failed check by hand if it has one"
    return 0
  fi
  if [ -z "$_run" ]; then
    echo "$_label: was never a promotion PR's head (no promote-ok run)"
    return 0
  fi
  act "$_label" "$_run" restart
  return 0
}

if [ -z "${REPO:-}" ] || [ -z "${WORKFLOW:-}" ]; then
  warn "promote-recheck needs REPO and WORKFLOW"
  exit 0
fi
HEADS=""
recheck staging trunk
recheck live staging
recheck_superseded
exit "$FAILED"

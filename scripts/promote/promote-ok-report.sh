#!/bin/sh
# promote-ok-report: write promote-ok.sh's verdict as the `promote-ok` check
# run on a promotion PR's head commit.
#
# The required check `promote-ok` is a check run written here through the
# Checks API with the job's GITHUB_TOKEN, so it belongs to the GitHub Actions
# app (id 15368), the app the rulesets pin it to. No Actions job is named
# promote-ok: a job can only end success, failure, cancelled or skipped, and
# "not yet" must be neither red nor passing. Here it is a check run left
# in_progress (pending): the PR cannot merge, and the trunk commit that is the
# Release Candidate PR's head shows a pending dot instead of a red X.
#
#   verdict pass        completed, success
#   verdict wait        in_progress (pending), with what it waits for
#   verdict fail        completed, failure (cannot ever, or the look failed)
#   verdict superseded  completed, neutral: only for a commit that is no
#                       longer any open promotion PR's head (promote-recheck.sh
#                       decides that), so nothing gates on it any more
#
# A check run once completed cannot go back to in_progress, and when a commit
# has several check runs of one name the newest one is the one that counts.
# So: the newest promote-ok run on the commit is updated in place when it is
# ours (external_id `promote-ok:<base>`, the base it was judged for) and either
# still pending or getting a completed verdict; a new one is created when
# there is none, when the newest belongs to another base (a trunk commit that
# was the Release Candidate PR's head and is now the Release PR's head after
# staging moved to it), or when a completed one goes back to waiting.
#
# A green check is never turned back to pending: two looks can finish out of
# order (the PR's own evaluation and a recheck), and once what a PR publishes
# exists for a commit it stays there, so an older "not yet" that lands after
# a newer "ready" is dropped with a note.
#
# Environment:
#   REPO           owner/name
#   HEAD_SHA       the commit to report on
#   BASE           staging | live (the PR base the verdict is for)
#   VERDICT_FILE   promote-ok.sh's verdict file; a missing or unreadable one
#                  is reported as a failure (fail closed)
#   VERDICT        optional; overrides the verdict in the file (superseded)
#   DETAILS_URL    optional; the run that judged it
#   CHECK_APP_ID   optional; the app whose check runs count (default 15368)
#   DRY_RUN        true: say what would be written, write nothing
set -eu

CHECK_NAME="promote-ok"
APP_ID="${CHECK_APP_ID:-15368}"

die() {
  echo "::error title=promote-ok report::$1" >&2
  exit 1
}

[ -n "${REPO:-}" ] || die "REPO is not set"
[ -n "${HEAD_SHA:-}" ] || die "HEAD_SHA is not set"
case "${BASE:-}" in
  staging | live) ;;
  *) die "BASE must be staging or live, not '${BASE:-}'" ;;
esac

_kind=""
_message=""
if [ -n "${VERDICT_FILE:-}" ] && [ -r "$VERDICT_FILE" ]; then
  _kind="$(sed -n 's/^verdict=//p' "$VERDICT_FILE" | head -n 1)"
  _message="$(sed -n 's/^message=//p' "$VERDICT_FILE" | head -n 1)"
fi
if [ -n "${VERDICT:-}" ]; then
  _kind="$VERDICT"
fi
case "$_kind" in
  pass) _status=completed _conclusion=success _title="Ready to merge" ;;
  wait) _status=in_progress _conclusion="" _title="Not yet" ;;
  fail) _status=completed _conclusion=failure _title="Not mergeable" ;;
  superseded) _status=completed _conclusion=neutral _title="Superseded" ;;
  *)
    _status=completed _conclusion=failure _title="Not mergeable"
    _message="the promote-ok evaluation ended without a verdict${_message:+: $_message}"
    ;;
esac
[ -n "$_message" ] || _message="$_title"

_external="promote-ok:$BASE"
SHORT="$(printf '%s' "$HEAD_SHA" | cut -c1-7)"

# The newest promote-ok run of the app on the commit: "<id> <status> <external_id>",
# or "none".
_latest="$(gh api "repos/$REPO/commits/$HEAD_SHA/check-runs?check_name=$CHECK_NAME&filter=all&per_page=100" \
  --jq "[.check_runs[] | select(.app.id == $APP_ID)] | sort_by(.id) | last
        | if . == null then \"none\" else \"\\(.id) \\(.status) \\(.external_id // \"-\") \\(.conclusion // \"-\")\" end")" ||
  die "could not list the $CHECK_NAME check runs of $SHORT"

_id=""
_mode=create
if [ "$_latest" != "none" ]; then
  read -r _lid _lstatus _lext _lconclusion <<EOF
$_latest
EOF
  if [ "$_lext" = "$_external" ] && [ "$_status" = in_progress ] &&
    [ "$_lstatus:$_lconclusion" = completed:success ]; then
    echo "$SHORT ($BASE): $CHECK_NAME is already green from a later look; this older 'not yet' is dropped"
    exit 0
  fi
  if [ "$_lext" = "$_external" ]; then
    if [ "$_lstatus" != "completed" ] || [ "$_status" = "completed" ]; then
      _id="$_lid"
      _mode=update
    fi
  fi
fi

if [ "${DRY_RUN:-false}" = "true" ]; then
  echo "$SHORT ($BASE): would $_mode the $CHECK_NAME check: $_status${_conclusion:+ $_conclusion} — $_message (dry run)"
  exit 0
fi

set -- -f "status=$_status" -f "output[title]=$_title" -f "output[summary]=$_message"
if [ -n "$_conclusion" ]; then
  set -- "$@" -f "conclusion=$_conclusion"
fi
if [ -n "${DETAILS_URL:-}" ]; then
  set -- "$@" -f "details_url=$DETAILS_URL"
fi
if [ "$_mode" = update ]; then
  gh api -X PATCH "repos/$REPO/check-runs/$_id" "$@" --jq .id >/dev/null ||
    die "could not update the $CHECK_NAME check run $_id on $SHORT"
else
  gh api -X POST "repos/$REPO/check-runs" -f "name=$CHECK_NAME" -f "head_sha=$HEAD_SHA" \
    -f "external_id=$_external" "$@" --jq .id >/dev/null ||
    die "could not create the $CHECK_NAME check run on $SHORT"
fi
echo "$SHORT ($BASE): $CHECK_NAME is $_status${_conclusion:+ $_conclusion} — $_message"

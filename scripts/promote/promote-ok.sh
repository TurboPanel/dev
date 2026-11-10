#!/bin/sh
# promote-ok: is the thing a promotion PR will publish already there?
#
#   base staging  (the "Release Candidate" PR, head = trunk)
#       merging runs publish-rc.yml, which publishes an rc from the canary
#       built from the PR's head commit. Green only when that commit's trunk
#       CI run succeeded AND (repos with binaries) a canary manifest naming
#       exactly that commit is on the rolling `canary` release.
#   base live     (the "Release" PR, head = staging)
#       merging runs publish-release.yml, which releases the newest rc that
#       has not shipped (`version.sh release-rc`: versions come from tags, not a
#       file). Green only when that rc has a published GitHub release and
#       staging's head holds exactly its content (the rc commit is in staging
#       and the trees are identical).
#
# Read-only and fast: it looks once at runs, releases, tags and commits and
# ends; it never waits for a build and never re-runs tests. Three verdicts:
# pass (exit 0), "not yet" (exit 2: it names what is missing; the check stays
# pending, never red) and "cannot ever" or a failed look (exit 1, said
# plainly). With VERDICT_FILE set it also writes `verdict=pass|wait|fail` and
# `message=` there, which promote-ok-report.sh turns into the `promote-ok`
# check run. The caller's recheck workflow (gh-promote-ok-recheck.yml) looks
# again when what it waits for may exist: the trunk CI, the canary build and
# Publish Release Candidate finishing. It once polled in place for up to an
# hour; with many merges a day those idle jobs held the runners the canary
# builds they waited for needed.
#
# Environment:
#   REPO           owner/name
#   REPO_KIND      daemon | instance | ui | notes-only (notes-only: no canary)
#   CI_WORKFLOW    the trunk CI workflow file (publish-daemon-trunk.yml, build.yml, verify.yml)
#   BASE, HEAD_SHA the PR's base branch and head commit, or
#   PR_NUMBER      a PR to read them from (the manual dry run)
#   GITHUB_STEP_SUMMARY  optional; the verdict is appended to it
#   VERDICT_FILE   optional; the verdict is written to it (see above)
#   CANARY_WORKFLOW  optional; the workflow file whose run builds the canary
#                  (default: canary.yml for instance and ui repos, CI_WORKFLOW for daemon)
set -eu

# Versions come from tags and the canary release, never a file (version.sh).
VERSION_SH="$(dirname "$0")/version.sh"

say_summary() {
  _line="$1"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '%s\n' "$_line" >> "$GITHUB_STEP_SUMMARY"
  fi
  return 0
}

pass() {
  _msg="$1"
  echo "promote-ok: PASS — $_msg"
  say_summary "### promote-ok: ready to merge"
  say_summary "$_msg"
  verdict pass "$_msg"
  exit 0
}

# Cannot ever pass as things stand, or the look itself failed: a red check.
fail() {
  _msg="$1"
  echo "::error title=promote-ok::$_msg" >&2
  say_summary "### promote-ok: not mergeable"
  say_summary "$_msg"
  verdict fail "$_msg"
  exit 1
}

# Not yet: what this PR publishes is still being built. Exit 2, so a caller
# can tell it from a failure; the check stays pending, never red.
wait_for() {
  _msg="$1"
  echo "::notice title=promote-ok::$_msg"
  say_summary "### promote-ok: not yet"
  say_summary "$_msg"
  verdict wait "$_msg"
  exit 2
}

# The verdict for promote-ok-report.sh, when the caller names a file for it.
verdict() {
  _kind="$1"
  _text="$2"
  if [ -n "${VERDICT_FILE:-}" ]; then
    printf 'verdict=%s\nmessage=%s\n' "$_kind" "$_text" > "$VERDICT_FILE"
  fi
  return 0
}

need() {
  _name="$1"
  _value="$2"
  [ -n "$_value" ] || fail "promote-ok is misconfigured: $_name is not set"
  return 0
}

# Fill BASE and HEAD_SHA from PR_NUMBER when the caller did not pass them.
resolve_pr() {
  if [ -n "${HEAD_SHA:-}" ] && [ -n "${BASE:-}" ]; then
    return 0
  fi
  need PR_NUMBER "${PR_NUMBER:-}"
  _pr="$(gh api "repos/$REPO/pulls/$PR_NUMBER" --jq '"\(.base.ref) \(.head.sha) \(.state)"')"
  BASE="${_pr%% *}"
  _rest="${_pr#* }"
  HEAD_SHA="${_rest%% *}"
  echo "PR #$PR_NUMBER (${_rest#* }): base $BASE, head $HEAD_SHA"
  return 0
}

# The trunk CI run of HEAD_SHA: success | failure | cancelled | … | pending | missing.
# Only a run that tested the trunk commit itself counts (a push, or a manual
# re-run for a push GitHub failed to deliver) — a pull_request run tested a merge.
trunk_ci_state() {
  gh api "repos/$REPO/actions/workflows/$CI_WORKFLOW/runs?head_sha=$HEAD_SHA&branch=trunk&per_page=20" \
    --jq '[.workflow_runs[] | select(.event == "push" or .event == "workflow_dispatch")]
          | sort_by(.created_at) | last
          | if . == null then "missing" elif .status != "completed" then "pending" else .conclusion end' || return 1
  return 0
}

# What the canary build of HEAD_SHA is doing, as plain lines, so a "not yet"
# names the run it waits for. Best effort: any lookup that fails prints a
# short note and never changes the verdict.
canary_status() {
  _wf="${CANARY_WORKFLOW:-}"
  if [ -z "$_wf" ]; then
    case "$REPO_KIND" in
      instance | ui) _wf="canary.yml" ;;
      daemon) _wf="$CI_WORKFLOW" ;;
      *) _wf="" ;;
    esac
  fi
  [ -n "$_wf" ] || return 0
  _mine="$(gh api "repos/$REPO/actions/workflows/$_wf/runs?head_sha=$HEAD_SHA&per_page=20" \
    --jq '.workflow_runs | sort_by(.created_at) | last
          | if . == null then "none" else "\(.id) \(.status) \(.conclusion // "-") \(.html_url)" end' 2>/dev/null)" || _mine="unreadable"
  case "$_mine" in
    none) echo "  $_wf run for $SHORT: none found yet (it starts after the trunk build is green)" ;;
    unreadable) echo "  $_wf run for $SHORT: could not be read" ;;
    *)
      read -r _run_id _run_status _run_conclusion _run_url <<EOF2
$_mine
EOF2
      echo "  $_wf run for $SHORT: run $_run_id is $_run_status (conclusion $_run_conclusion) $_run_url"
      ;;
  esac
  _group="$(gh api "repos/$REPO/actions/workflows/$_wf/runs?per_page=30" \
    --jq '[.workflow_runs[] | select(.status != "completed")] | sort_by(.created_at)
          | if length == 0 then "nothing else is running or queued"
            else map("run \(.id) \(.status) for \((now - (.created_at | fromdateiso8601)) / 60 | floor) min") | join("; ") end' 2>/dev/null)" || _group="could not be read"
  echo "  $_wf runs not finished (oldest first): $_group"
  return 0
}

# One key of a version.sh answer (key=value lines).
version_key() {
  _key="$1"
  _answer="$2"
  printf '%s\n' "$_answer" | sed -n "s/^$_key=//p"
  return 0
}

check_trunk_ci() {
  _state="$(trunk_ci_state)" || fail "could not read the trunk $CI_WORKFLOW runs of $SHORT (GitHub API error). Re-run this check; it is also re-run when the trunk CI, the canary build or Publish Release Candidate next finishes."
  case "$_state" in
    success) echo "trunk $CI_WORKFLOW passed on $SHORT" ;;
    pending) wait_for "waiting for the trunk $CI_WORKFLOW run of $SHORT to finish; this re-checks automatically when it does." ;;
    missing) wait_for "waiting for a trunk $CI_WORKFLOW run of $SHORT (none has started yet); this re-checks automatically when it finishes." ;;
    *) fail "the trunk $CI_WORKFLOW run of $SHORT ended '$_state', so it will never get a canary. Merge a fix to trunk (or re-run that run); this PR then re-checks automatically." ;;
  esac
  return 0
}

check_rc_pr() {
  check_trunk_ci
  if [ "$REPO_KIND" = "notes-only" ]; then
    pass "trunk $CI_WORKFLOW passed on $SHORT; merging tags it as the next rc (notes-only repo, no canary)."
  fi
  _answer="$(GITHUB_OUTPUT="" sh "$VERSION_SH" canary-of "$HEAD_SHA")" || fail "could not read $REPO's canary release"
  _manifest="$(version_key asset "$_answer")"
  _version="$(version_key base "$_answer")"
  if [ -n "$_manifest" ]; then
    pass "canary $_manifest was built from $SHORT; merging publishes the next $_version rc from those bytes."
  fi
  echo "promote-ok: the canary of $SHORT is not on the canary release yet:"
  canary_status
  wait_for "waiting for the canary of $SHORT (no manifest-X.Y.Z-canary.N.json on the canary release names it yet); this re-checks automatically when its canary build finishes. If that build failed or is stuck, see the run lines above, then re-run or cancel it."
}

# One look at whether $_rc is ready to release: sets _ready=1, or _msg to why
# not. Reads _rc and HEAD_SHA; runs in the caller's shell (no subshell), so
# the caller sees both.
check_rc_release() {
  _msg="waiting for the $_rc GitHub release to be published; this re-checks automatically."
  _draft="$(gh api "repos/$REPO/releases/tags/$_rc" --jq .draft 2>/dev/null || echo missing)"
  [ "$_draft" = "false" ] || return 0
  _cmp="$(gh api "repos/$REPO/compare/$_rc...$HEAD_SHA" --jq '"\(.behind_by) \(.base_commit.commit.tree.sha)"')" ||
    fail "could not compare $_rc with staging ($SHORT) (GitHub API error). Re-run this check."
  _behind="${_cmp%% *}"
  _rc_tree="${_cmp#* }"
  _head_tree="$(gh api "repos/$REPO/git/commits/$HEAD_SHA" --jq .tree.sha)" ||
    fail "could not read the tree of staging ($SHORT) (GitHub API error). Re-run this check."
  if [ "$_behind" != "0" ]; then
    _msg="staging ($SHORT) does not contain $_rc (the newest rc), so merging would release bytes that are not on staging. Waiting for staging to be moved to $_rc; this re-checks automatically."
  elif [ "$_rc_tree" != "$_head_tree" ]; then
    _msg="staging ($SHORT) has changes that are not in $_rc (the newest rc). Waiting for Publish Release Candidate to publish the next rc; this re-checks automatically."
  else
    _ready=1
  fi
  return 0
}

# Which rc is "the newest" is read from the tags on this one look. Merging the
# Release Candidate PR moves staging (and so this PR's head) before Publish
# Release Candidate has pushed the new rc tag, so this look can still see the
# previous rc and report "not yet"; Publish Release Candidate finishing
# re-runs it. "No rc newer than the latest release exists at all" cannot
# resolve on its own (an rc comes from merging the Release Candidate PR).
check_release_pr() {
  _ready=0
  _answer="$(GITHUB_OUTPUT="" sh "$VERSION_SH" release-rc)" || fail "could not work out the newest rc from $REPO's tags (version.sh release-rc failed); this re-checks automatically, or re-run this check."
  _rc="$(version_key rc-tag "$_answer")"
  _version="$(version_key version "$_answer")"
  [ -n "$_rc" ] || wait_for "no rc newer than the latest release exists yet; merge the Release Candidate PR first. This re-checks automatically."
  check_rc_release
  if [ "$_ready" = 1 ]; then
    pass "$_rc is published and staging ($SHORT) is exactly its content; merging releases v$_version from it."
  fi
  wait_for "$_msg"
}

main() {
  need REPO "${REPO:-}"
  need REPO_KIND "${REPO_KIND:-}"
  need CI_WORKFLOW "${CI_WORKFLOW:-}"
  resolve_pr
  SHORT="$(printf '%s' "$HEAD_SHA" | cut -c1-7)"
  case "$BASE" in
    staging) check_rc_pr ;;
    live) check_release_pr ;;
    *) fail "promote-ok only gates PRs into staging or live, not '$BASE'" ;;
  esac
}

main

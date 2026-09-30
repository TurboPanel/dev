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
# Read-only and fast: it looks at runs, releases, tags and commits; it never
# re-runs tests. Red means "not yet" (or "cannot ever", said plainly); the
# caller's recheck workflow re-runs it when the missing piece appears.
#
# Environment:
#   REPO           owner/name
#   REPO_KIND      daemon | instance | ui | notes-only (notes-only: no canary)
#   CI_WORKFLOW    the trunk CI workflow file (publish-daemon-trunk.yml, build.yml, verify.yml)
#   BASE, HEAD_SHA the PR's base branch and head commit, or
#   PR_NUMBER      a PR to read them from (the manual dry run)
#   GITHUB_STEP_SUMMARY  optional; the verdict is appended to it
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
  exit 0
}

fail() {
  _msg="$1"
  echo "::error title=promote-ok::$_msg" >&2
  say_summary "### promote-ok: not yet"
  say_summary "$_msg"
  exit 1
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
          | if . == null then "missing" elif .status != "completed" then "pending" else .conclusion end'
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
  _state="$(trunk_ci_state)"
  case "$_state" in
    success) echo "trunk $CI_WORKFLOW passed on $SHORT" ;;
    pending) fail "waiting for the trunk $CI_WORKFLOW run of $SHORT to finish; this re-checks automatically." ;;
    missing) fail "waiting for a trunk $CI_WORKFLOW run of $SHORT (none has started yet); this re-checks automatically." ;;
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
  if [ -z "$_manifest" ]; then
    fail "waiting for the canary of $SHORT (no manifest-X.Y.Z-canary.N.json on the canary release names it yet); this re-checks automatically. If the canary run for it failed, re-run that run."
  fi
  pass "canary $_manifest was built from $SHORT; merging publishes the next $_version rc from those bytes."
}

check_release_pr() {
  _answer="$(GITHUB_OUTPUT="" sh "$VERSION_SH" release-rc)" || fail "could not work out the newest rc from $REPO's tags"
  _rc="$(version_key rc-tag "$_answer")"
  _version="$(version_key version "$_answer")"
  [ -n "$_rc" ] || fail "no rc newer than the latest release exists yet; merge the Release Candidate PR first. This re-checks automatically."
  _draft="$(gh api "repos/$REPO/releases/tags/$_rc" --jq .draft 2>/dev/null || echo missing)"
  [ "$_draft" = "false" ] || fail "waiting for the $_rc GitHub release to be published; this re-checks automatically."
  _cmp="$(gh api "repos/$REPO/compare/$_rc...$HEAD_SHA" --jq '"\(.behind_by) \(.base_commit.commit.tree.sha)"')"
  _behind="${_cmp%% *}"
  _rc_tree="${_cmp#* }"
  _head_tree="$(gh api "repos/$REPO/git/commits/$HEAD_SHA" --jq .tree.sha)"
  if [ "$_behind" != "0" ]; then
    fail "staging ($SHORT) does not contain $_rc (the newest rc), so merging would release bytes that are not on staging. Waiting for staging to be moved to $_rc; this re-checks automatically."
  fi
  if [ "$_rc_tree" != "$_head_tree" ]; then
    fail "staging ($SHORT) has changes that are not in $_rc (the newest rc). Waiting for Publish Release Candidate to publish the next rc; this re-checks automatically."
  fi
  pass "$_rc is published and staging ($SHORT) is exactly its content; merging releases v$_version from it."
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

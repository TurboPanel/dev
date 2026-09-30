#!/bin/sh
# start-version.sh: start the next minor or major in each repo named. The
# logic behind the daemon repo's "Start Next Version" workflow
# (turbopaneld .github/workflows/start-next-version.yml).
#
#   GH_TOKEN=<Release App token> start-version.sh <minor|major> <owner/repo>:<trunk build workflow> ...
#
# For each repo, the target is the next minor (X.Y+1.0) or major (X+1.0.0)
# after that repo's OWN newest release (cli.mjs start; repos release
# independently). A repo already building the target or later is left alone,
# so pressing the button twice is harmless. Otherwise it:
#
#   1. pushes the annotated tag start/v<target> at the repo's trunk head. That
#      marker is the whole signal: the repo's base becomes <target>
#      (lib.mjs nextBase) and no file changes. It matches no release-tag
#      ruleset and no tag-push trigger (those match v[0-9]*).
#   2. runs <trunk build workflow> on trunk, so the next canary (and the
#      Release Candidate PR) carries the new number without waiting for the
#      next merge. A failure here is a warning with the manual step: the
#      marker is already in place and the next merge picks it up anyway.
#
# DRY_RUN=true reports what would happen and changes nothing. START_MESSAGE is
# the tag message. One line per repo goes to stdout and to GITHUB_STEP_SUMMARY.
# Exits 1 when any repo could not be read or marked (the others still are).
set -eu

CLI="${CLI:-$(dirname "$0")/cli.mjs}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

report() {
  _line="$1"
  echo "$_line"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf -- '- %s\n' "$_line" >> "$GITHUB_STEP_SUMMARY"
  fi
  return 0
}

problem() {
  _line="$1"
  echo "::error::$_line" >&2
  report "$_line"
  return 1
}

plan_value() {
  _key="$1"
  sed -n "s/^$_key=//p" "$WORK/plan"
  return 0
}

# Run the repo's trunk build so a canary with the new number follows at once.
rebuild() {
  _repo="$1"
  _workflow="$2"
  if gh workflow run "$_workflow" --repo "$_repo" --ref trunk > "$WORK/run.log" 2>&1; then
    report "$_repo: $_workflow started on trunk; its canary and the Release Candidate PR will carry the new number"
  else
    cat "$WORK/run.log" >&2
    echo "::warning::$_repo: could not start $_workflow; run it on trunk by hand (Actions, $_workflow, Run workflow)" >&2
    report "$_repo: could not start $_workflow; run it on trunk by hand, or the next merge picks the new number up"
  fi
  return 0
}

start_repo() {
  _spec="$1"
  _repo="${_spec%%:*}"
  _workflow="${_spec#*:}"
  gh api --paginate "repos/$_repo/git/matching-refs/tags/" --jq '.[].ref' > "$WORK/tags" \
    || { problem "$_repo: could not list its tags"; return 1; }
  GITHUB_OUTPUT="" node "$CLI" start --bump "$BUMP" --tags "$WORK/tags" > "$WORK/plan" \
    || { problem "$_repo: could not work out the $BUMP to start"; return 1; }
  _target="$(plan_value target)"
  _base="$(plan_value base)"
  _released="$(plan_value released)"
  if [ "$(plan_value started)" = "true" ]; then
    report "$_repo: already building $_base, which is $_target or later; nothing to start"
    return 0
  fi
  _tag="start/v$_target"
  _head="$(gh api "repos/$_repo/commits/trunk" --jq .sha)" \
    || { problem "$_repo: could not read trunk's head"; return 1; }
  _short="$(printf '%s' "$_head" | cut -c1-7)"
  if [ "$DRY_RUN" = "true" ]; then
    report "$_repo: would start $_target (newest release ${_released:-none}, building $_base now): $_tag at $_short, then $_workflow on trunk (dry run)"
    return 0
  fi
  _object="$(gh api --method POST "repos/$_repo/git/tags" -f "tag=$_tag" -f "message=$START_MESSAGE" \
    -f "object=$_head" -f type=commit --jq .sha)" \
    || { problem "$_repo: could not create the $_tag tag object"; return 1; }
  gh api --method POST "repos/$_repo/git/refs" -f "ref=refs/tags/$_tag" -f "sha=$_object" > /dev/null \
    || { problem "$_repo: could not push $_tag (does it already exist?)"; return 1; }
  report "$_repo: started $_target (newest release ${_released:-none}): $_tag at $_short"
  rebuild "$_repo" "$_workflow"
}

main() {
  BUMP="${1:-}"
  case "$BUMP" in
    minor|major) ;;
    *) echo "::error::usage: start-version.sh <minor|major> <owner/repo>:<workflow> ... (got '$BUMP')" >&2; exit 1 ;;
  esac
  shift
  [ "$#" -gt 0 ] || { echo "::error::start-version.sh: name at least one <owner/repo>:<workflow>" >&2; exit 1; }
  DRY_RUN="${DRY_RUN:-false}"
  START_MESSAGE="${START_MESSAGE:-Start the next $BUMP}"
  _failed=0
  for _spec in "$@"; do
    case "$_spec" in
      */*:*) start_repo "$_spec" || _failed=1 ;;
      *) problem "not <owner/repo>:<workflow>: '$_spec'" || _failed=1 ;;
    esac
  done
  exit "$_failed"
}

main "$@"

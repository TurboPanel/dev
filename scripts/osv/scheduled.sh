#!/bin/sh
# scheduled.sh: the weekly dependency advisory sweep (Road to 0.2.x
# r2-osv-scheduled-issues). The pull request gate (scan.sh) stays as it is;
# this is its second half: warning-level advisories (below HIGH, or no fixed
# version yet) never fail a pull request, so they are collected here into ONE
# tracking issue per repo titled "Dependency advisories".
#
#   scheduled.sh [dir]
#
# - Warnings only: create the issue, or update it in place (found by exact
#   title, so it is never duplicated). Reopens a closed one. Exit 0.
# - No warnings: if the issue is open, post "all clear" and close it. Exit 0.
# - Issues disabled, or no token: the list goes to the workflow summary only
#   (fail soft, exit 0).
# - A BLOCKING advisory (HIGH/CRITICAL with a fix) is listed too and the run
#   fails, so the schedule goes red where the gate would have.
# - A scanner error fails the run with the scanner's own exit code.
#
# Environment: OSV_SCANNER, OSV_REPORT (as scan.sh), GH_TOKEN and
# GITHUB_REPOSITORY (issues need `issues: write`), GITHUB_STEP_SUMMARY.
set -eu

HERE="$(dirname "$0")"
DIR="${1:-.}"
SCANNER="${OSV_SCANNER:-osv-scanner}"
REPORT="${OSV_REPORT:-${RUNNER_TEMP:-/tmp}/osv-report.json}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
TITLE="Dependency advisories"
TAB="$(printf '\t')"
BODY="${RUNNER_TEMP:-/tmp}/osv-issue-body.md"

set +e
"$SCANNER" scan source --recursive --format json --output-file "$REPORT" "$DIR"
code=$?
set -e
case "$code" in
  0 | 1) ;;
  *)
    echo "::error title=Dependency advisory sweep::osv-scanner failed (exit $code); no verdict" >&2
    exit "$code"
    ;;
esac

VERDICTS="$(jq -r -f "$HERE/gate.jq" "$REPORT")"

blocking=0
warnings=0
rows=""
while IFS="$TAB" read -r verdict package ids severity fix; do
  [ -n "$verdict" ] || continue
  case "$verdict" in
    BLOCK) blocking=$((blocking + 1)) ;;
    warn) warnings=$((warnings + 1)) ;;
    *)
      echo "::error title=Dependency advisory sweep::unexpected verdict line: $verdict" >&2
      exit 1
      ;;
  esac
  rows="${rows}| ${verdict} | \`${package}\` | ${ids} | ${severity} | ${fix} |
"
done <<EOF
$VERDICTS
EOF

{
  echo "Weekly dependency scan (osv-scanner). Warnings do not fail pull requests; this issue keeps them visible. It updates itself and closes when the list is empty."
  echo
  if [ -n "$rows" ]; then
    echo "| Verdict | Package | Advisories | Severity | Fix |"
    echo "| --- | --- | --- | --- | --- |"
    printf '%s' "$rows"
  else
    echo "No open advisories."
  fi
  echo
  echo "Last scan: $(date -u +%Y-%m-%dT%H:%MZ). Override for an advisory verified not exploitable: an [[IgnoredVulns]] entry with a reason in osv-scanner.toml."
} >"$BODY"

{
  echo "## ${TITLE}"
  echo
  echo "${warnings} warning(s), ${blocking} blocking."
  echo
  cat "$BODY"
} >>"$SUMMARY"
echo "Dependency advisories: ${warnings} warning(s), ${blocking} blocking."

# Issue tracking: best effort, never the reason the run fails.
sync_issue() {
  [ -n "${GH_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] || return 1
  export GH_REPO="$GITHUB_REPOSITORY"
  enabled="$(gh api "repos/${GITHUB_REPOSITORY}" --jq .has_issues)" || return 1
  [ "$enabled" = "true" ] || return 1
  number="$(gh issue list --state all --search "\"${TITLE}\" in:title" --json number,title,state --limit 100 \
    --jq "[.[] | select(.title == \"${TITLE}\")] | sort_by(.number) | .[0].number // empty")" || return 1
  if [ -z "$number" ]; then
    [ -n "$rows" ] || return 0
    gh issue create --title "$TITLE" --body-file "$BODY" >/dev/null || return 1
    return 0
  fi
  state="$(gh issue view "$number" --json state --jq .state)" || return 1
  if [ -n "$rows" ]; then
    gh issue edit "$number" --body-file "$BODY" >/dev/null || return 1
    [ "$state" = "OPEN" ] || gh issue reopen "$number" >/dev/null || return 1
  elif [ "$state" = "OPEN" ]; then
    gh issue edit "$number" --body-file "$BODY" >/dev/null || return 1
    gh issue close "$number" --comment "All clear: the weekly scan found no advisories." >/dev/null || return 1
  fi
  return 0
}

if ! sync_issue; then
  echo "::notice title=Dependency advisory sweep::No tracking issue written (issues disabled or no token); the list is in the workflow summary."
fi

if [ "$blocking" -gt 0 ]; then
  echo "::error title=Dependency advisory sweep::${blocking} blocking advisor(y/ies) (HIGH/CRITICAL with a fix). Upgrade, or add an [[IgnoredVulns]] entry with a reason." >&2
  exit 1
fi
exit 0

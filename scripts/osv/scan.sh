#!/bin/sh
# scan.sh: the dependency advisory gate every TurboPanel repo runs in CI
# (Road to 0.2.x r2-osv-gate-policy, owner decision 2026-09-30).
#
#   scan.sh [dir]     scans dir (default .) recursively with osv-scanner
#
# Fails only for an advisory rated HIGH or CRITICAL that already has a fixed
# version (the rule is gate.jq, next to this script). Every other finding is
# printed and annotated as a warning, never a failure: a newly published
# low-severity or not-yet-fixable advisory must not turn every pull request in
# the repo red.
#
# Override for a blocking advisory that is verified not exploitable here: an
# [[IgnoredVulns]] entry in that repo's osv-scanner.toml, with id, a written
# reason, and ignoreUntil when a fix is expected. osv-scanner drops ignored
# advisories before this gate sees them.
#
# A scanner error (any exit other than 0 = clean or 1 = findings) fails the
# gate with the scanner's own exit code: no report, no verdict.
#
# Environment: OSV_SCANNER (default osv-scanner on PATH), OSV_REPORT (where the
# JSON report goes; default under RUNNER_TEMP or /tmp).
set -eu

HERE="$(dirname "$0")"
DIR="${1:-.}"
SCANNER="${OSV_SCANNER:-osv-scanner}"
REPORT="${OSV_REPORT:-${RUNNER_TEMP:-/tmp}/osv-report.json}"
TAB="$(printf '\t')"

set +e
"$SCANNER" scan source --recursive --format json --output-file "$REPORT" "$DIR"
code=$?
set -e
case "$code" in
  0 | 1) ;;
  *)
    echo "::error title=Dependency advisory gate::osv-scanner failed (exit $code); no verdict"
    exit "$code"
    ;;
esac

VERDICTS="$(jq -r -f "$HERE/gate.jq" "$REPORT")"

blocking=0
total=0
while IFS="$TAB" read -r verdict package ids severity fix; do
  [ -n "$verdict" ] || continue
  total=$((total + 1))
  case "$verdict" in
    BLOCK)
      blocking=$((blocking + 1))
      echo "::error title=Dependency advisory (blocking)::$package $ids, severity $severity, $fix. Upgrade it, or add an [[IgnoredVulns]] entry with a reason to osv-scanner.toml if it is verified not exploitable here."
      ;;
    warn)
      echo "::warning title=Dependency advisory::$package $ids, severity $severity, $fix. Not blocking: below HIGH, or no fixed version yet."
      ;;
    *)
      echo "::error title=Dependency advisory gate::unexpected verdict line: $verdict"
      exit 1
      ;;
  esac
done <<EOF
$VERDICTS
EOF

echo "Dependency advisories: $total found, $blocking blocking."
if [ "$blocking" -gt 0 ]; then
  exit 1
fi
exit 0

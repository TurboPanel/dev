#!/bin/sh
# Best effort: re-run the failed CI on the open staging → live "Release" PR of
# each repo named, so a minor-release gate (gh-minor-gate.yml) that was red
# because a sibling was not ready yet re-evaluates the moment it is.
#
#   GH_TOKEN=<Release App token with actions:write> rerun-release-pr-checks.sh turbopaneld ui ...
#
# Never fails the caller: anything that cannot be re-run is only reported, and
# the owner can re-run the failed check by hand.
for repo in "$@"; do
  pr="$(gh pr list --repo "TurboPanel/$repo" --base live --head staging --state open --json headRefOid --jq '.[0].headRefOid // empty' 2>/dev/null)" || pr=""
  if [ -z "$pr" ]; then
    echo "$repo: no open Release PR — nothing to re-run"
    continue
  fi
  runs="$(gh run list --repo "TurboPanel/$repo" --event pull_request --commit "$pr" --json databaseId,conclusion --jq '.[] | select(.conclusion == "failure") | .databaseId' 2>/dev/null)" || runs=""
  if [ -z "$runs" ]; then
    echo "$repo: no failed run on $pr — nothing to re-run"
    continue
  fi
  for id in $runs; do
    if gh run rerun "$id" --repo "TurboPanel/$repo" --failed >/dev/null 2>&1; then
      echo "$repo: re-ran the failed checks of run $id"
    else
      echo "::warning::$repo: could not re-run run $id — re-run its failed checks by hand" >&2
    fi
  done
done
exit 0

#!/bin/sh
# Start a new minor across the three pieces that ship together (turbopaneld,
# turbopanel, ui): open a "Start X.Y.0" PR into each repo's trunk that moves
# its version files to the minor, so every repo's canaries — and the rc a minor
# release needs from each — carry the new number.
#
#   GH_TOKEN=<Release App token> CLI=<path to cli.mjs> start-minor.sh X.Y.0 [repo-to-skip ...]
#
# Repos already on that minor (or later) are left alone, and so is a repo that
# already has the PR open. Nothing merges itself.
set -eu
target="$1"
shift
skip=" $* "
case "$target" in
  [0-9]*.[0-9]*.0) ;;
  *) echo "::error::start-minor takes a minor (X.Y.0), got '$target'" >&2; exit 1 ;;
esac
tmajmin="${target%.*}"

# repo:first-version-file:all files (comma separated)
for spec in \
  "turbopaneld:deno.json:deno.json,sonar-project.properties" \
  "turbopanel:deno.json:deno.json,package.json,sonar-project.properties" \
  "ui:package.json:package.json,app.json,sonar-project.properties"; do
  repo="${spec%%:*}"
  rest="${spec#*:}"
  first="${rest%%:*}"
  files="${rest#*:}"
  case "$skip" in *" $repo "*) echo "$repo: skipped"; continue ;; esac

  current="$(gh api "repos/TurboPanel/$repo/contents/$first?ref=trunk" --jq .content | base64 -d | jq -r .version)"
  cmajmin="${current%.*}"
  # Already on this minor or a later one? (compare major.minor numerically)
  if [ "$(printf '%s\n%s\n' "$cmajmin.0" "$tmajmin.0" | sort -V | tail -n 1)" = "$cmajmin.0" ]; then
    echo "$repo: trunk is at $current — already on $tmajmin or later"
    continue
  fi
  branch="release/start-$target"
  if [ -n "$(gh pr list --repo "TurboPanel/$repo" --head "$branch" --state open --json number --jq '.[0].number // empty')" ]; then
    echo "$repo: PR for $branch is already open"
    continue
  fi

  work="$(mktemp -d)"
  git clone -q --depth 1 --branch trunk "https://x-access-token:${GH_TOKEN}@github.com/TurboPanel/$repo.git" "$work"
  (
    cd "$work"
    echo "$files" | tr ',' '\n' > "$work.files"
    node "$CLI" bump-files --from "$current" --to "$target" --files "$work.files"
    git config user.name "turbopanel-release[bot]"
    git config user.email "turbopanel-release[bot]@users.noreply.github.com"
    git checkout -q -b "$branch"
    git add -- $(cat "$work.files")
    git commit -q -m "Start $target"
    git push -q origin "$branch"
    gh pr create --repo "TurboPanel/$repo" --base trunk --head "$branch" \
      --title "Start $target" \
      --body "A new minor is starting. This moves trunk from $current to **$target** so this repo's canaries — and the rc that the minor release needs from every one of turbopaneld, turbopanel and ui — carry the new number. Order for the minor: an rc in turbopanel and ui, then the daemon releases $target, then turbopanel and ui release it. Squash-merge when \`ci-ok\` is green."
  )
  rm -rf "$work" "$work.files"
  echo "$repo: opened Start $target"
done

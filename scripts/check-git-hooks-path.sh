#!/usr/bin/env sh
# Regression check: every present development checkout must use core.hooksPath=.githooks
# when .githooks/pre-commit exists.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
# shellcheck source=scripts/lib/paths.sh
. "$SCRIPT_DIR/lib/paths.sh"
# shellcheck source=scripts/lib/git-github-ssh.sh
. "$SCRIPT_DIR/lib/git-github-ssh.sh"

failed=0

for dir in dev turbopaneld turbopanel ui website; do
  root=$(tp_platform_repo_path "$dir")
  if [ ! -d "$root" ]; then
    continue
  fi
  if [ ! -f "$root/.githooks/pre-commit" ]; then
    continue
  fi
  if ! git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "check-git-hooks-path: skip ${root} (not a git work tree)" >&2
    continue
  fi
  hooks_path=$(git -C "$root" config --local --get core.hooksPath 2>/dev/null || true)
  if [ "$hooks_path" != ".githooks" ]; then
    echo "check-git-hooks-path: ${root} has core.hooksPath=${hooks_path:-<unset>} (expected .githooks)" >&2
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "check-git-hooks-path: run ./console or ensureAllGitHooksPaths to repair" >&2
  exit 1
fi

echo "check-git-hooks-path: all present checkouts wired"

#!/usr/bin/env sh
# Promote a soaked pre-release to `latest` — the release rail's pointer move.
#
# On GitHub Releases the promotion is `gh release edit vX.Y.Z
# --prerelease=false`: `releases/latest` moves, no compiler runs, the bytes
# are the ones that soaked on the internal fleet. This wrapper adds the two
# refusals the Road to 0.1.x page asks for (`promotion`):
#
#   - it refuses to *build*: no release for that tag is a failure, never a
#     fallback compile;
#   - it re-verifies every asset against the release's own manifest.json
#     first — re-downloaded from the release, re-hashed — and refuses to
#     flip a release whose bytes no longer match what CI published.
#
# Usage:
#   scripts/promote-release.sh <owner/repo> <version-without-v> [--dry-run]
#
#   scripts/promote-release.sh TurboPanel/turbopaneld 0.1.0
#   scripts/promote-release.sh TurboPanel/ui 0.1.0 --dry-run
#
# Needs `gh` (authenticated with contents:write on the repo), `python3`,
# `curl`. Every repo's release.yml publishes manifest.json in the same
# artifact shape gh-release.yml verifies (any object carrying url + sha256 +
# size, wherever it sits), so one promoter serves all five repos.

set -eu

usage() {
  echo "usage: $0 <owner/repo> <version-without-v> [--dry-run]" >&2
  exit 2
}

[ $# -ge 2 ] || usage
repo="$1"
version="$2"
shift 2
dry_run=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    *) usage ;;
  esac
done

case "$version" in
  v*) echo "promote-release: pass the version without a leading v (got $version)" >&2; exit 2 ;;
esac
tag="v${version}"

for tool in gh python3 curl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "promote-release: $tool is required" >&2; exit 1; }
done

# 1. The release must already exist. Nothing here ever builds one.
if ! release_json="$(gh release view "$tag" --repo "$repo" --json isPrerelease,isDraft,tagName,assets 2>/dev/null)"; then
  echo "promote-release: no release for ${repo}@${tag} — cut the tag and let release.yml publish it; this script never builds" >&2
  exit 1
fi

is_prerelease="$(printf '%s' "$release_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["isPrerelease"])')"
is_draft="$(printf '%s' "$release_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["isDraft"])')"
if [ "$is_draft" = "True" ]; then
  echo "promote-release: ${repo}@${tag} is a draft — publish it as a pre-release first" >&2
  exit 1
fi
if [ "$is_prerelease" != "True" ]; then
  echo "promote-release: ${repo}@${tag} is already latest-eligible (not a pre-release); nothing to promote" >&2
  exit 1
fi

# 2. Re-verify every asset against the release's own manifest.
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT INT TERM

manifest_url="https://github.com/${repo}/releases/download/${tag}/manifest.json"
if ! curl -fsSL -o "$workdir/manifest.json" "$manifest_url"; then
  echo "promote-release: ${repo}@${tag} has no manifest.json asset (${manifest_url}) — a release without one cannot be verified, so it is not promoted" >&2
  exit 1
fi

python3 - "$workdir/manifest.json" "$repo" "$tag" "$workdir" <<'PY'
import hashlib
import json
import os
import sys
import urllib.request

manifest_path, repo, tag, workdir = sys.argv[1:5]
with open(manifest_path) as f:
    manifest = json.load(f)


def walk(node, path):
    if isinstance(node, dict):
        if {"url", "sha256", "size"} <= node.keys():
            yield path, node
            return
        for key, value in node.items():
            yield from walk(value, f"{path}.{key}" if path else key)
    elif isinstance(node, list):
        for i, value in enumerate(node):
            yield from walk(value, f"{path}[{i}]")


checks = list(walk(manifest, ""))
if not checks:
    print(f"promote-release: manifest.json names no artifacts", file=sys.stderr)
    sys.exit(1)

failed = False
for name, entry in checks:
    filename = entry["url"].rsplit("/", 1)[-1]
    release_url = f"https://github.com/{repo}/releases/download/{tag}/{filename}"
    if entry["url"] != release_url:
        print(
            f"promote-release: {name} points outside this release: "
            f"manifest={entry['url']} expected={release_url}",
            file=sys.stderr,
        )
        failed = True
        continue
    req = urllib.request.Request(release_url, headers={"User-Agent": "turbopanel-promote"})
    with urllib.request.urlopen(req) as resp:
        data = resp.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != entry["sha256"] or len(data) != entry["size"]:
        print(
            f"promote-release: {name} does not match its manifest entry: "
            f"expected sha256={entry['sha256']} size={entry['size']} "
            f"got sha256={digest} size={len(data)}",
            file=sys.stderr,
        )
        failed = True
        continue
    print(f"verified {name}: {filename} ({len(data)} bytes)")

if failed:
    sys.exit(1)
print(
    f"promote-release: {len(checks)} asset(s) of {repo}@{tag} match manifest.json "
    f"(commit {manifest.get('commit', '?')}, version {manifest.get('version', '?')})"
)
PY

# 3. The pointer move.
if [ "$dry_run" = "1" ]; then
  echo "promote-release: dry run — would run: gh release edit $tag --repo $repo --prerelease=false --latest"
  exit 0
fi
gh release edit "$tag" --repo "$repo" --prerelease=false --latest
echo "promote-release: ${repo}@${tag} is now latest — releases/latest/download/manifest.json points at it"

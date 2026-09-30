#!/bin/sh
# version.sh: a repo's version numbers, worked out from its git tags and its
# rolling canary release. No file and no "Start x.y.z" PR decides them (Road
# to 0.2.x, versioning Phase 3); the rules live in lib.mjs (nextBase,
# nextCanaryNumber, newestUnreleasedRc) and are run through cli.mjs.
#
#   version.sh base              release=<newest release>  base=<version trunk builds now>
#   version.sh canary            base=…  number=<N>  version=<base>-canary.<N>  (the next canary)
#   version.sh canary-of <sha>   asset=manifest-<v>.json  version=<v>  base=…  (the canary built
#                                from <sha>; all empty when none is on the canary release)
#   version.sh release-rc        rc-tag=<vB-rc.N>  version=<B>  (the newest rc not yet released;
#                                both empty when every rc has shipped)
#
# Environment: REPO (owner/name), GH_TOKEN for gh; CLI optionally points at
# cli.mjs (defaults to the one next to this script). Prints key=value lines and,
# when GITHUB_OUTPUT is set, appends them to it. Read-only: it never creates a
# tag or a release.
set -eu

CLI="${CLI:-$(dirname "$0")/cli.mjs}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

die() {
  _msg="$1"
  echo "::error::version: $_msg" >&2
  exit 1
}

# One key=value line to stdout, and to GITHUB_OUTPUT when the caller has one.
out() {
  _line="$1"
  printf '%s\n' "$_line"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s\n' "$_line" >> "$GITHUB_OUTPUT"
  fi
  return 0
}

# Every tag of the repo (release tags, rc tags, start/ markers), one ref per line.
list_tags() {
  gh api --paginate "repos/$REPO/git/matching-refs/tags/" --jq '.[].ref' > "$WORK/tags" \
    || die "could not list $REPO's tags"
  return 0
}

# Every asset name on the rolling canary release; none when the repo has no
# canary release. Any other failure stops: guessing "no builds yet" would hand
# out a number an earlier build already carries.
list_canary_assets() {
  if gh release view canary --repo "$REPO" --json assets --jq '.assets[].name' > "$WORK/assets" 2> "$WORK/assets.err"; then
    return 0
  fi
  if grep -q 'release not found' "$WORK/assets.err"; then
    : > "$WORK/assets"
    return 0
  fi
  cat "$WORK/assets.err" >&2
  die "could not read $REPO's canary release"
}

# Run a cli.mjs command and pass its key=value lines on.
cli() {
  _command="$1"
  GITHUB_OUTPUT="" node "$CLI" "$@" > "$WORK/cli" || die "cli.mjs $_command failed"
  while IFS= read -r _line; do
    out "$_line"
  done < "$WORK/cli"
  return 0
}

# The newest canary manifest copy naming <sha>: newest first (highest version,
# then highest counter), stopping at the first match.
canary_of() {
  _sha="$1"
  [ -n "$_sha" ] || die "canary-of needs a commit"
  list_canary_assets
  _found=""
  _names="$(grep -E '^manifest-[[:digit:]]+\.[[:digit:]]+\.[[:digit:]]+-canary\.[[:digit:]]+\.json$' "$WORK/assets" | sort -V -r || true)"
  for _name in $_names; do
    gh release download canary --repo "$REPO" --pattern "$_name" --output "$WORK/m.json" --clobber \
      || die "could not download $_name"
    if [ "$(jq -r '.commit // empty' "$WORK/m.json")" = "$_sha" ]; then
      _found="$_name"
      break
    fi
  done
  _version=""
  _base=""
  if [ -n "$_found" ]; then
    _version="${_found#manifest-}"
    _version="${_version%.json}"
    _base="${_version%%-canary.*}"
  fi
  out "asset=$_found"
  out "version=$_version"
  out "base=$_base"
  return 0
}

main() {
  _mode="${1:-}"
  _commit="${2:-}"
  [ -n "${REPO:-}" ] || die "REPO is not set"
  case "$_mode" in
    base)
      list_tags
      cli base --tags "$WORK/tags"
      ;;
    canary)
      list_tags
      list_canary_assets
      cli canary-version --tags "$WORK/tags" --canary-assets "$WORK/assets"
      ;;
    canary-of)
      canary_of "$_commit"
      ;;
    release-rc)
      list_tags
      cli release-rc --tags "$WORK/tags"
      ;;
    *)
      die "usage: version.sh base | canary | canary-of <sha> | release-rc (got '$_mode')"
      ;;
  esac
}

main "$@"

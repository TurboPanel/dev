#!/bin/sh
# version-pr.sh: open the "chore: start X.Y.Z" pull request that moves a
# repo's committed version numbers to X.Y.Z. The tags still work out what the
# version should be (lib.mjs nextBase); the committed files have to agree, and
# each repo's canary build refuses to run while they do not
# (node scripts/set-version.mjs --check). This PR is how they come to agree:
# the Release App opens it right after each release (the next patch), and
# Start Next Version opens it for a new minor or major (start-version.sh). The
# owner merges it.
#
#   GH_TOKEN=<Release App token> version-pr.sh <owner/repo> <X.Y.Z>
#
#   1. shallow-clones the repo's trunk (the token goes in as an HTTP header
#      through the environment; it is never written into the clone);
#   2. runs `<SET_VERSION> <X.Y.Z>` in the clone. No file changed: the repo is
#      already at X.Y.Z and there is nothing to do;
#   3. an open PR from the branch version/<X.Y.Z> already exists: reports it;
#   4. points version/<X.Y.Z> at trunk's head (creates it, or resets a branch
#      left over without an open PR);
#   5. makes the commit with the GraphQL createCommitOnBranch mutation, which
#      takes no author: GitHub makes and signs the commit for the token's
#      owner, so it shows as Verified. Nothing is ever `git push`ed;
#   6. opens the PR into trunk.
#
# Environment: GH_TOKEN for gh and the clone; SET_VERSION (default
# `node scripts/set-version.mjs`); REASON, one sentence for the PR body on why
# it was opened (default: after the newest release); DRY_RUN=true clones and
# runs SET_VERSION but changes nothing on GitHub; GIT_BASE (default
# https://github.com) is where `<owner/repo>.git` is cloned from.
# Prints one report line to stdout and GITHUB_STEP_SUMMARY, and `pr-url=<url>`
# to GITHUB_OUTPUT when set: the new or already-open PR, empty when the repo
# was already at X.Y.Z or on a dry run. Every failure is an ::error:: line and
# exit 1.
set -eu

BASE_BRANCH=trunk
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

die() {
  _msg="$1"
  echo "::error::$REPO: $_msg" >&2
  report "$REPO: $_msg"
  exit 1
}

output_url() {
  _url="$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'pr-url=%s\n' "$_url" >> "$GITHUB_OUTPUT"
  fi
  return 0
}

# Shallow clone of trunk into $WORK/repo. The token rides in an HTTP header
# set through GIT_CONFIG_* so it is in neither argv nor the clone's config.
clone_trunk() {
  _url="${GIT_BASE:-https://github.com}/$REPO.git"
  if [ -n "${GH_TOKEN:-}" ]; then
    _auth="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')"
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraheader \
      GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $_auth" \
      git clone -q --depth 1 --single-branch --branch "$BASE_BRANCH" "$_url" "$WORK/repo" 2> "$WORK/clone.err" \
      || { cat "$WORK/clone.err" >&2; die "could not clone $BASE_BRANCH"; }
  else
    git clone -q --depth 1 --single-branch --branch "$BASE_BRANCH" "$_url" "$WORK/repo" 2> "$WORK/clone.err" \
      || { cat "$WORK/clone.err" >&2; die "could not clone $BASE_BRANCH"; }
  fi
  return 0
}

# Run SET_VERSION in the clone, then list what it changed: $WORK/changed
# (added or modified, one path per line) and $WORK/deleted.
set_version() {
  _cmd="${SET_VERSION:-node scripts/set-version.mjs}"
  if [ "$_cmd" = "node scripts/set-version.mjs" ] && [ ! -f "$WORK/repo/scripts/set-version.mjs" ]; then
    die "$BASE_BRANCH has no scripts/set-version.mjs; merge the change that adds it first"
  fi
  (cd "$WORK/repo" && sh -c "$_cmd \"\$1\"" set-version "$VERSION") > "$WORK/set.log" 2>&1 \
    || { cat "$WORK/set.log" >&2; die "'$_cmd $VERSION' failed"; }
  git -C "$WORK/repo" add -A
  git -C "$WORK/repo" diff --cached --name-only --diff-filter=d > "$WORK/changed"
  git -C "$WORK/repo" diff --cached --name-only --diff-filter=D > "$WORK/deleted"
  return 0
}

# The createCommitOnBranch request: every changed file's new contents
# (base64), every deleted path, and trunk's head as the expected branch head.
commit_body() {
  _additions='[]'
  while IFS= read -r _path; do
    [ -n "$_path" ] || continue
    _b64="$(base64 < "$WORK/repo/$_path" | tr -d '\n')"
    _additions="$(printf '%s' "$_additions" | jq -c --arg p "$_path" --arg c "$_b64" '. + [{path: $p, contents: $c}]')"
  done < "$WORK/changed"
  _deletions="$(jq -R -s -c 'split("\n") | map(select(length > 0) | {path: .})' < "$WORK/deleted")"
  jq -n \
    --arg repo "$REPO" --arg branch "$BRANCH" --arg head "$HEAD" --arg title "$TITLE" \
    --arg body "Moves the committed version numbers to $VERSION." \
    --argjson additions "$_additions" --argjson deletions "$_deletions" \
    '{
      query: "mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid url } } }",
      variables: { input: {
        branch: { repositoryNameWithOwner: $repo, branchName: $branch },
        message: { headline: $title, body: $body },
        expectedHeadOid: $head,
        fileChanges: { additions: $additions, deletions: $deletions }
      } }
    }' > "$WORK/commit.json"
  return 0
}

# Point $BRANCH at trunk's head: reset it when it exists (no open PR uses it),
# create it otherwise.
point_branch() {
  if gh api "repos/$REPO/git/ref/heads/$BRANCH" --jq .object.sha > /dev/null 2>&1; then
    gh api --method PATCH "repos/$REPO/git/refs/heads/$BRANCH" -f "sha=$HEAD" -F force=true > /dev/null \
      || die "could not reset the $BRANCH branch to $BASE_BRANCH's head"
  else
    gh api --method POST "repos/$REPO/git/refs" -f "ref=refs/heads/$BRANCH" -f "sha=$HEAD" > /dev/null \
      || die "could not create the $BRANCH branch"
  fi
  return 0
}

pr_body() {
  printf '%s\n\n' "${REASON:-It was opened after the newest release.}"
  printf '%s\n\n' "The git tags say the next version is $VERSION, and canary builds are refused until the committed version numbers say the same. Merging this PR moves them to $VERSION; nothing else changes."
  printf 'Files:\n'
  sed 's/^/- `/; s/$/`/' "$WORK/changed" "$WORK/deleted"
  return 0
}

main() {
  REPO="${1:-}"
  VERSION="${2:-}"
  case "$REPO" in
    */*) ;;
    *) echo "::error::usage: version-pr.sh <owner/repo> <X.Y.Z> (got repo '$REPO')" >&2; exit 1 ;;
  esac
  if ! printf '%s' "$VERSION" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
    echo "::error::usage: version-pr.sh <owner/repo> <X.Y.Z> (got version '$VERSION')" >&2
    exit 1
  fi
  BRANCH="version/$VERSION"
  TITLE="chore: start $VERSION"

  clone_trunk
  HEAD="$(git -C "$WORK/repo" rev-parse HEAD)"
  _short="$(printf '%s' "$HEAD" | cut -c1-7)"
  set_version
  if [ ! -s "$WORK/changed" ] && [ ! -s "$WORK/deleted" ]; then
    report "$REPO: already at $VERSION on $BASE_BRANCH ($_short); no PR needed"
    output_url ""
    return 0
  fi
  _files="$(cat "$WORK/changed" "$WORK/deleted" | paste -sd ',' - | sed 's/,/, /g')"

  _owner="${REPO%%/*}"
  _open="$(gh api "repos/$REPO/pulls?state=open&base=$BASE_BRANCH&head=$_owner:$BRANCH" --jq '.[0].html_url // empty')" \
    || die "could not look for an open $BRANCH PR"
  if [ -n "$_open" ]; then
    report "$REPO: \"$TITLE\" is already open: $_open"
    output_url "$_open"
    return 0
  fi
  if [ "${DRY_RUN:-false}" = "true" ]; then
    report "$REPO: would open \"$TITLE\" ($BRANCH at $_short into $BASE_BRANCH) changing $_files (dry run)"
    output_url ""
    return 0
  fi

  point_branch
  commit_body
  _oid="$(gh api graphql --input "$WORK/commit.json" --jq '.data.createCommitOnBranch.commit.oid // empty' 2> "$WORK/commit.err")" \
    || { cat "$WORK/commit.err" >&2; die "createCommitOnBranch failed on $BRANCH"; }
  [ -n "$_oid" ] || { cat "$WORK/commit.err" >&2; die "createCommitOnBranch returned no commit on $BRANCH"; }

  pr_body > "$WORK/pr.md"
  _url="$(gh api --method POST "repos/$REPO/pulls" -f "title=$TITLE" -f "head=$BRANCH" -f "base=$BASE_BRANCH" \
    -F "body=@$WORK/pr.md" --jq .html_url)" \
    || die "could not open the PR from $BRANCH (the commit is on the branch: open it by hand)"
  report "$REPO: opened \"$TITLE\" ($_files): $_url"
  output_url "$_url"
  return 0
}

main "$@"

#!/bin/sh
# Markdown changelog for a release candidate / release / promotion PR: one line
# per commit between two refs: the squash-merge title (with its PR number), the
# issues that PR closes ("closes #12"), then the author's avatar and name (a
# link to their profile) after the text; then a "Thanks to" line crediting each
# contributor once.
#
#   GH_TOKEN=<token> changelog.sh <owner/repo> <base-ref> <head-ref> [max-lines]
#
# `base-ref` is usually the previous release tag; an empty base (a first release)
# prints nothing. Merge commits are skipped. A commit whose author has no GitHub
# account shows the git author name instead. Needs gh and jq.
set -eu
repo="$1"
base="${2:-}"
head="$3"
max="${4:-60}"

[ -n "$base" ] || exit 0

json="$(gh api "repos/$repo/compare/$base...$head" --jq '{total: .total_commits, commits: [.commits[] | select((.parents | length) == 1)]}')"

# The issues each pull request closes (its "Closes #N" links), one GraphQL call
# for every PR number a squash-merge title carries. Best effort: any failure just
# leaves the issue links out.
issues='{}'
prs="$(printf '%s' "$json" | jq -r '[.commits[] | (.commit.message | split("\n")[0]) | capture("\\(#(?<n>[0-9]+)\\)$")? | .n] | unique | .[]')"
if [ -n "$prs" ]; then
  owner="${repo%%/*}"
  name="${repo#*/}"
  fields=""
  for n in $prs; do
    fields="$fields p$n: pullRequest(number: $n) { closingIssuesReferences(first: 5) { nodes { number title url } } }"
  done
  query="query { repository(owner: \"$owner\", name: \"$name\") { $fields } }"
  issues="$(gh api graphql -f query="$query" 2>/dev/null || echo '{}')"
  printf '%s' "$issues" | jq -e . >/dev/null 2>&1 || issues='{}'
fi

printf '%s' "$json" | jq -r --arg repo "$repo" --argjson max "$max" --argjson issues "$issues" '
  def subject: (.commit.message | split("\n")[0]);
  def closes:
    ((subject | capture("\\(#(?<n>[0-9]+)\\)$")?) as $m
      | if $m == null then [] else (try (($issues.data.repository // {})["p" + $m.n].closingIssuesReferences.nodes // []) catch []) end)
    | map("[#\(.number)](\(.url))")
    | if length > 0 then " · closes " + join(", ") else "" end;
  def who:
    if .author then
      "<a href=\"" + .author.html_url + "\"><img src=\"" + .author.avatar_url + "&s=40\" width=\"20\" height=\"20\" align=\"absmiddle\" alt=\"" + .author.login + "\"></a> [" + .author.login + "](" + .author.html_url + ")"
    else
      .commit.author.name
    end;
  def person:
    "<a href=\"" + .author.html_url + "\"><img src=\"" + .author.avatar_url + "&s=40\" width=\"20\" height=\"20\" align=\"absmiddle\" alt=\"" + .author.login + "\"></a> [" + .author.login + "](" + .author.html_url + ")";
  (.commits | length) as $n
  | (.commits[:$max][] | "- " + subject + closes + " — " + who),
    (if $n > $max then "- … and \($n - $max) more commits: https://github.com/\($repo)/compare/'"$base"'...'"$head"'" else empty end),
    ([.commits[] | select(.author != null)] | unique_by(.author.login) as $people
     | if ($people | length) > 0 then "", "**Thanks to** " + ($people | map(person) | join(" · ")) else empty end)
'

#!/bin/sh
# Markdown changelog for a release candidate / release / promotion PR: one line
# per commit between two refs, each with its author's avatar, @name (a link to
# their profile) and the PR number the squash-merge title carries, then a
# "Thanks to" line crediting each contributor once.
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

printf '%s' "$json" | jq -r --arg repo "$repo" --argjson max "$max" '
  def subject: (.commit.message | split("\n")[0]);
  def who:
    if .author then
      "<a href=\"" + .author.html_url + "\"><img src=\"" + .author.avatar_url + "&s=40\" width=\"20\" height=\"20\" alt=\"@" + .author.login + "\"></a> [@" + .author.login + "](" + .author.html_url + ")"
    else
      .commit.author.name
    end;
  def person:
    "<a href=\"" + .author.html_url + "\"><img src=\"" + .author.avatar_url + "&s=40\" width=\"24\" height=\"24\" alt=\"@" + .author.login + "\"></a> [@" + .author.login + "](" + .author.html_url + ")";
  (.commits | length) as $n
  | (.commits[:$max][] | "- " + who + " — " + subject),
    (if $n > $max then "- … and \($n - $max) more commits: https://github.com/\($repo)/compare/'"$base"'...'"$head"'" else empty end),
    ([.commits[] | select(.author != null)] | unique_by(.author.login) as $people
     | if ($people | length) > 0 then "", "**Thanks to** " + ($people | map(person) | join(" · ")) else empty end)
'

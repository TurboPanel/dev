#!/usr/bin/env sh
# Lock down trunk, staging, live and the release tags on every TurboPanel repo
# with repository rulesets (run once with gh authenticated as an org admin;
# re-running updates the rulesets in place).
#
# APPLY ORDER — do not run this version until the `ci-ok` aggregator job exists
# on trunk in every repo (turbopanel#37, turbopaneld#38, ui#16, website#20,
# dev#14). It makes `ci-ok` the only required check; if that job does not run
# on a repo yet, every PR there blocks forever.
#
# Per repo:
#
#   trunk: immutable history   — no bypass for anyone: trunk cannot be
#                                deleted or force-pushed, ever.
#   trunk: review and CI       — changes land only through a pull request
#                                whose `ci-ok` check is green, squash merges
#                                only (linear history). NO bypass actors:
#                                PR-only applies to the owner and to agents.
#                                Zero required approvals, so a solo maintainer
#                                can still merge their own green PR. Break-glass
#                                is flipping the ruleset's enforcement to
#                                Disabled in the repo settings, pushing, and
#                                re-enabling — visible in the audit log.
#                                `require_extra_approval_for_unattributed_changes`
#                                is set false explicitly (a probe on dev#13
#                                showed it does not block agent-opened PRs
#                                today; false removes the dependency on that).
#                                Required checks are not strict (a PR whose own
#                                CI was green may merge after trunk moved; the
#                                canary build catches combined conflicts).
#   staging & live: immutable history — no bypass: the deploy branches cannot
#                                be deleted or force-pushed.
#   staging & live: review and CI — pull request + green `ci-ok`, merge commits
#                                only (promotions are fast-forwards or merge
#                                commits, never squashes, so the branch keeps
#                                trunk's SHAs). No bypass actors; hotfix path
#                                is a PR into live with green CI, and the same
#                                enforcement flip is the break-glass. Checks
#                                need not be up to date with the base.
#   release tags: immutable    — no bypass: a bare vX.Y.Z tag can never be
#                                moved or deleted once it exists.
#   release tags: creation     — only repository admins create bare vX.Y.Z
#                                tags. The pattern mirrors release.yml's
#                                push filter (v[0-9]*) and then EXCLUDES
#                                hyphenated pre-release tags (v*-*): rulesets
#                                bind GITHUB_TOKEN too, and gh-release.yml
#                                creates v0.1.1-rc.1 / v0.1.1-canary.<id>
#                                itself with that token, then prunes old
#                                canaries. The rolling `rc` / `canary`
#                                pointers and vtest-* dry-run tags never
#                                matched the pattern in the first place.
#
# Planned (not yet wired): a "TurboPanel Release" GitHub App becomes an
# Integration bypass actor on `release tags: creation` and on `staging & live:
# review and CI`, so an environment-approved promotion run can create the bare
# tag and fast-forward the deploy branches. Fill RELEASE_APP_BYPASS with
# `[{"actor_id": <app installation id>, "actor_type": "Integration",
# "bypass_mode": "always"}]` once the owner has created and installed the App.
#
# Required check: one context, `ci-ok`, pinned to the GitHub Actions app
# (integration_id 15368 — `gh api apps/github-actions --jq .id`) so a
# same-named commit status from any other source cannot satisfy it. Do not
# add SonarCloud's external check here — a required context that an app
# never reports on a fork PR blocks the merge with no recourse.
set -eu

if ! command -v gh >/dev/null 2>&1; then
  echo "enable-trunk-branch-protection: install GitHub CLI (gh) and authenticate" >&2
  exit 1
fi

# Repository role "admin" (the fixed id GitHub assigns it). Used only on
# `release tags: creation` until the Release App takes that role over.
ADMIN_BYPASS='[{"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always"}]'

# The "TurboPanel Release" GitHub App — empty until the owner creates it; see
# the header. When set, it is added to the tag-creation and staging/live
# review rulesets in a later edit of this script.
RELEASE_APP_BYPASS='[]'

# GitHub Actions app id: `gh api apps/github-actions --jq .id`.
ACTIONS_INTEGRATION_ID=15368

# Repos whose Workers deploy from `staging` / `live` branches.
STAGING_LIVE_REPOS="TurboPanel/turbopanel TurboPanel/turbopaneld TurboPanel/ui TurboPanel/website"

# Every repo requires exactly one check: the `ci-ok` aggregator job, which
# fails unless every real CI job in that repo's PR workflow succeeded.
checks_for() {
  printf '[{"context": "ci-ok", "integration_id": %s}]' "$ACTIONS_INTEGRATION_ID"
}

# upsert <repo> <name> <json-body>
upsert() {
  _repo="$1"; _name="$2"; _body="$3"
  _id="$(gh api "/repos/${_repo}/rulesets" --jq ".[] | select(.name == \"${_name}\") | .id")"
  if [ -n "$_id" ]; then
    printf '%s' "$_body" | gh api --method PUT "/repos/${_repo}/rulesets/${_id}" --input - >/dev/null
    echo "   updated  ${_name} (#${_id})"
  else
    _id="$(printf '%s' "$_body" | gh api --method POST "/repos/${_repo}/rulesets" --input - --jq .id)"
    echo "   created  ${_name} (#${_id})"
  fi
}

for repo in TurboPanel/turbopanel TurboPanel/turbopaneld TurboPanel/ui TurboPanel/website TurboPanel/dev; do
  echo "→ ${repo}"

  upsert "$repo" "trunk: immutable history" '{
    "name": "trunk: immutable history",
    "target": "branch",
    "enforcement": "active",
    "bypass_actors": [],
    "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
    "rules": [{"type": "deletion"}, {"type": "non_fast_forward"}]
  }'

  upsert "$repo" "trunk: review and CI" "{
    \"name\": \"trunk: review and CI\",
    \"target\": \"branch\",
    \"enforcement\": \"active\",
    \"bypass_actors\": [],
    \"conditions\": {\"ref_name\": {\"include\": [\"~DEFAULT_BRANCH\"], \"exclude\": []}},
    \"rules\": [
      {\"type\": \"pull_request\", \"parameters\": {
        \"required_approving_review_count\": 0,
        \"dismiss_stale_reviews_on_push\": true,
        \"require_code_owner_review\": false,
        \"require_last_push_approval\": false,
        \"require_extra_approval_for_unattributed_changes\": false,
        \"required_review_thread_resolution\": true,
        \"allowed_merge_methods\": [\"squash\"]
      }},
      {\"type\": \"required_status_checks\", \"parameters\": {
        \"strict_required_status_checks_policy\": false,
        \"required_status_checks\": $(checks_for "$repo")
      }},
      {\"type\": \"required_linear_history\"}
    ]
  }"

  upsert "$repo" "release tags: immutable" '{
    "name": "release tags: immutable",
    "target": "tag",
    "enforcement": "active",
    "bypass_actors": [],
    "conditions": {"ref_name": {"include": ["refs/tags/v[0-9]*"], "exclude": ["refs/tags/v*-*"]}},
    "rules": [{"type": "update"}, {"type": "deletion"}]
  }'

  upsert "$repo" "release tags: creation" "{
    \"name\": \"release tags: creation\",
    \"target\": \"tag\",
    \"enforcement\": \"active\",
    \"bypass_actors\": ${ADMIN_BYPASS},
    \"conditions\": {\"ref_name\": {\"include\": [\"refs/tags/v[0-9]*\"], \"exclude\": [\"refs/tags/v*-*\"]}},
    \"rules\": [{\"type\": \"creation\"}]
  }"

  case " ${STAGING_LIVE_REPOS} " in
    *" ${repo} "*) ;;
    *) continue ;;
  esac

  upsert "$repo" "staging & live: immutable history" '{
    "name": "staging & live: immutable history",
    "target": "branch",
    "enforcement": "active",
    "bypass_actors": [],
    "conditions": {"ref_name": {"include": ["refs/heads/staging", "refs/heads/live"], "exclude": []}},
    "rules": [{"type": "deletion"}, {"type": "non_fast_forward"}]
  }'

  upsert "$repo" "staging & live: review and CI" "{
    \"name\": \"staging & live: review and CI\",
    \"target\": \"branch\",
    \"enforcement\": \"active\",
    \"bypass_actors\": ${RELEASE_APP_BYPASS},
    \"conditions\": {\"ref_name\": {\"include\": [\"refs/heads/staging\", \"refs/heads/live\"], \"exclude\": []}},
    \"rules\": [
      {\"type\": \"pull_request\", \"parameters\": {
        \"required_approving_review_count\": 0,
        \"dismiss_stale_reviews_on_push\": true,
        \"require_code_owner_review\": false,
        \"require_last_push_approval\": false,
        \"require_extra_approval_for_unattributed_changes\": false,
        \"required_review_thread_resolution\": true,
        \"allowed_merge_methods\": [\"merge\"]
      }},
      {\"type\": \"required_status_checks\", \"parameters\": {
        \"strict_required_status_checks_policy\": false,
        \"required_status_checks\": $(checks_for "$repo")
      }}
    ]
  }"
done

echo "✓ rulesets applied: trunk immutable + PR-only w/ ci-ok, squash (no bypass); staging & live immutable + PR-only w/ ci-ok, merge commits (no bypass); bare vX.Y.Z tags immutable + admin-only creation (v*-* pre-release tags left to Actions)"

#!/usr/bin/env sh
# Lock down trunk and the release tags on every TurboPanel repo with
# repository rulesets (run once with gh authenticated as an org admin;
# re-running updates the rulesets in place).
#
# Per repo, four rulesets:
#
#   trunk: immutable history   — no bypass for anyone: trunk cannot be
#                                deleted or force-pushed, ever.
#   trunk: review and CI       — changes land through a pull request whose
#                                required checks are green on an up-to-date
#                                head, squash/rebase only (linear history).
#                                Repository admins bypass this one so the
#                                owner's direct pushes keep working while the
#                                team is one person; GitHub records each
#                                bypass. To require PRs of yourself too,
#                                drop the bypass_actors entry below.
#   release tags: immutable    — no bypass: a v<digit>* tag can never be
#                                moved or deleted once it exists.
#   release tags: creation     — only repository admins create v<digit>*
#                                tags. The pattern mirrors release.yml's
#                                push filter (v[0-9]*), so the rolling `rc`
#                                pointer and the vtest-* dry-run tags that
#                                gh-release.yml creates with GITHUB_TOKEN
#                                stay outside it.
#
# Required check contexts are the PR-time job names: `verify` where the
# repo's verify.yml runs on pull_request, plus turbopanel's Build jobs.
# Do not add SonarCloud's external check here — a required context that an
# app never reports on a fork PR blocks the merge with no recourse.
set -eu

if ! command -v gh >/dev/null 2>&1; then
  echo "enable-trunk-branch-protection: install GitHub CLI (gh) and authenticate" >&2
  exit 1
fi

# Repository role "admin" (the fixed id GitHub assigns it).
ADMIN_BYPASS='[{"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always"}]'

checks_for() {
  case "$1" in
    TurboPanel/turbopanel) printf '%s' '[{"context": "SonarQube"}, {"context": "metrics-legacy"}]' ;;
    TurboPanel/turbopaneld) printf '%s' '[{"context": "verify"}]' ;;
    *) printf '%s' '[{"context": "verify"}, {"context": "metrics-legacy"}]' ;;
  esac
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
    \"bypass_actors\": ${ADMIN_BYPASS},
    \"conditions\": {\"ref_name\": {\"include\": [\"~DEFAULT_BRANCH\"], \"exclude\": []}},
    \"rules\": [
      {\"type\": \"pull_request\", \"parameters\": {
        \"required_approving_review_count\": 0,
        \"dismiss_stale_reviews_on_push\": true,
        \"require_code_owner_review\": false,
        \"require_last_push_approval\": false,
        \"required_review_thread_resolution\": true,
        \"allowed_merge_methods\": [\"squash\", \"rebase\"]
      }},
      {\"type\": \"required_status_checks\", \"parameters\": {
        \"strict_required_status_checks_policy\": true,
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
    "conditions": {"ref_name": {"include": ["refs/tags/v[0-9]*"], "exclude": []}},
    "rules": [{"type": "update"}, {"type": "deletion"}]
  }'

  upsert "$repo" "release tags: creation" "{
    \"name\": \"release tags: creation\",
    \"target\": \"tag\",
    \"enforcement\": \"active\",
    \"bypass_actors\": ${ADMIN_BYPASS},
    \"conditions\": {\"ref_name\": {\"include\": [\"refs/tags/v[0-9]*\"], \"exclude\": []}},
    \"rules\": [{\"type\": \"creation\"}]
  }"
done

echo "✓ rulesets applied: trunk immutable + PR/CI (admin bypass), v[0-9]* tags immutable + admin-only creation"

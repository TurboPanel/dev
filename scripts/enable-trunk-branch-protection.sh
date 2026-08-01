#!/usr/bin/env sh
# Require the Verify workflow on trunk for sibling repos (run once with gh + admin).
set -eu

if ! command -v gh >/dev/null 2>&1; then
  echo "enable-trunk-branch-protection: install GitHub CLI (gh) and authenticate" >&2
  exit 1
fi

for repo in turbopanel/instance turbopanel/ui turbopanel/website; do
  echo "→ ${repo} trunk protection"
  gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "/repos/${repo}/branches/trunk/protection" \
    --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Verify / verify"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
done

echo "✓ trunk branch protection updated (Verify / verify required)"

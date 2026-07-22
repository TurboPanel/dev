# dev-turbopanel-sh

Cloudflare Worker that serves the dev bootstrap script (`develop.sh`) from
**https://dev.turbopanel.sh** with correct `Content-Type` and `Cache-Control: no-store`
headers so `curl | sh` fetches are always fresh.

## Source of truth

`scripts/develop.sh` in the dev repo is the only copy. The deploy flow stages it
into a gitignored `public/develop.sh` before upload — nothing is duplicated in git.

## Prerequisites

- The **turbopanel.sh** zone must already exist in the TurboPanel Cloudflare
  account so the **dev.turbopanel.sh** `custom_domain` route can provision DNS
  and an edge certificate.
- Cloudflare API credentials for `wrangler deploy` (e.g. `CLOUDFLARE_API_TOKEN`).

## Deploy

From this directory:

```bash
npm install
npm run deploy
```

`deploy` runs `wrangler deploy`, which executes the `build.command` in
`wrangler.jsonc` first (staging `../../scripts/develop.sh` → `public/develop.sh`)
then uploads. Cloudflare Workers Builds that invoke `npx wrangler deploy` directly
get the same stage step automatically.

## Legacy URL

Existing references to **https://trbp.nl/develop.sh** remain valid after repointing
the dashboard-managed redirect to **https://dev.turbopanel.sh** (bare). No code
changes are required in `develop.sh` or bootstrap paths — `curl -fsSL` follows
the redirect.

## Verify

```bash
curl -fsSL https://dev.turbopanel.sh | head
curl -fsSL https://dev.turbopanel.sh/develop.sh | head
curl -sI https://dev.turbopanel.sh | grep -E '^(content-type|cache-control):'
```

Expect `Content-Type: text/x-shellscript; charset=utf-8` and
`Cache-Control: no-store`.

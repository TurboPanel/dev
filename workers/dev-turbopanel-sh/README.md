# dev-turbopanel-sh

Assets-only Workers Static Assets deployment of the dev bootstrap script
(`develop.sh`) on **https://dev.turbopanel.sh** — no Worker script, so public
bootstrap requests are free/unbilled. `/develop.sh` is the static asset; the bare
root is a `200` proxy rewrite to that file (no client redirect). Both paths are
served with `Content-Type: text/x-shellscript; charset=utf-8` and
`Cache-Control: no-store` so `curl | sh` fetches are always fresh.

## Source of truth

`scripts/develop.sh` in the dev repo is the only copy. The deploy flow stages it
into a gitignored `public/develop.sh` before upload — nothing is duplicated in git.

Committed asset config lives under `assets/` (`_headers`, `_redirects`) and is
staged into `public/` next to `develop.sh` by `pnpm run stage`. Wrangler consumes
those files at deploy time rather than uploading them as downloadable assets.

Non-GET/HEAD requests no longer get a hand-rolled `405` from Worker code —
method handling is whatever the asset server returns.

## Prerequisites

- The **turbopanel.sh** zone must already exist in the TurboPanel Cloudflare
  account so the **dev.turbopanel.sh** `custom_domain` route can provision DNS
  and an edge certificate.
- Cloudflare API credentials for `wrangler deploy` (e.g. `CLOUDFLARE_API_TOKEN`).

## Deploy

From this directory:

```bash
pnpm install --frozen-lockfile
pnpm run deploy
```

`pnpm-lock.yaml` is committed so Cloudflare Workers Builds can run
`pnpm install --frozen-lockfile` in this subdirectory (the dev repo root uses
pnpm; a conflicting npm lockfile or `packageManager` here breaks CI). Local
installs may use `pnpm install` when the lockfile changes.

`deploy` runs `wrangler deploy`, which executes the `build.command` in
`wrangler.jsonc` first (staging `../../scripts/develop.sh` → `public/develop.sh`
plus `assets/_headers` and `assets/_redirects` into `public/`) then uploads.
Cloudflare Workers Builds that invoke `npx wrangler deploy` directly get the
same stage step automatically.

## Legacy URL

Existing references to **https://trbp.nl/develop.sh** remain valid after
repointing the dashboard-managed redirect to be **path-preserving**
(`trbp.nl/develop.sh` → `https://dev.turbopanel.sh/develop.sh`) so installs
resolve in one hop instead of bouncing through the bare host. No code changes
are required in `develop.sh` or bootstrap paths — `curl -fsSL` follows the
redirect via `-L`.

## Verify

```bash
curl -sI https://dev.turbopanel.sh
curl -fsSL https://dev.turbopanel.sh | head
curl -fsSL https://dev.turbopanel.sh/develop.sh | head
curl -sI https://dev.turbopanel.sh/develop.sh | grep -E '^(content-type|cache-control):'
```

Expect `200` with the shell body on both the bare host and `/develop.sh`, and
`Content-Type: text/x-shellscript; charset=utf-8` plus `Cache-Control: no-store`
on each. No `-L` is required for the bare host.

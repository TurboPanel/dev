# dev-turbopanel-sh

Assets-only Workers Static Assets deployment on **dev.turbopanel.sh** — no
Worker script, so public requests are free/unbilled. The bare root serves a
short shellscript (`Content-Type: text/x-shellscript; charset=utf-8`,
`Cache-Control: no-store`) that prints the Vagrant-based contributor setup
instructions. It does **not** clone or install anything.

## Source of truth

`scripts/dev-setup.sh` in the dev repo is the only copy. The deploy flow stages
it into a gitignored `public/bootstrap` before upload — nothing is duplicated
in git.

Committed asset config lives under `assets/` (`_headers`, `_redirects`) and is
staged into `public/` by `pnpm run stage`. Wrangler consumes those files at
deploy time rather than uploading them as downloadable assets.

Canonical docs: [Local development](https://turbopanel.io/docs/getting-started/development).

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
`wrangler.jsonc` first (staging `../../scripts/dev-setup.sh` → `public/bootstrap`
plus `assets/_headers` and `assets/_redirects` into `public/`) then uploads.
Cloudflare Workers Builds that invoke `npx wrangler deploy` directly get the
same stage step automatically.

## Verify

```bash
curl -sI https://dev.turbopanel.sh
curl -fsSL dev.turbopanel.sh | head
curl -sI https://dev.turbopanel.sh | grep -E '^(content-type|cache-control):'
```

Expect `200` with the shell body on the bare host, and
`Content-Type: text/x-shellscript; charset=utf-8` plus `Cache-Control: no-store`.

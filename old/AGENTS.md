# AGENTS.md

## What this repo is

`turbopanel-dev` is the **developer environment orchestration repository** for the TurboPanel project. It contains the idempotent bootstrap script (`pull.sh`), Tilt orchestration, shared developer documentation, and is the single source of truth for bootstrapping a local development environment.

**https://develop.trbp.nl** redirects to the GitHub repository; the bootstrap script is fetched from GitHub raw (`trunk` branch).

**Local dev defaults to Cloudflare Workers** — `pnpm dev` / wrangler in `instance/`. Set `TURBOPANEL_INSTANCE_RUNTIME=deno` in `dev/.env` (or use the **Switch to Deno Mode** button in the Tilt UI nav) to run the self-hosted Deno instance on a Unix socket instead. Caddy proxies HTTPS to wrangler (TCP) or the Deno socket depending on runtime.

## Repository layout

```
turbopanel/
├── dev/      # this repo — scripts, docs, shared dev tooling
│   ├── pull.sh            # clone/update sibling repos
│   ├── Tiltfile           # Workers + Caddy Tilt orchestration
│   ├── .env.example       # local dev variable template
│   ├── .postgresql/       # local Postgres data (gitignored; created by sync-env.sh)
│   ├── scripts/
│   │   └── sync-env.sh    # dev/.env → sibling repo env files
│   └── docker/
│       ├── postgres.compose.yml  # local Postgres for Hyperdrive
│       ├── caddy.compose.yml     # Caddy in Docker (127.0.0.1:8443 publish)
│       └── Caddyfile             # HTTPS proxy → host wrangler + Expo
├── instance/ # turbopanel/turbopanel — core server (Workers entry: src/workers.ts)
├── ui/       # turbopanel/turbopanel-ui — frontend
├── daemon/   # turbopanel/turbopanel-daemon — co-located agent (Tilt `daemon` resource) (not started by Tilt)
└── website/  # turbopanel/turbopanel-website — marketing + docs site (port 19820)
```

## Bootstrap script

- **`pull.sh`** — clones/updates sibling repos; contributors run it with `sh pull.sh`.
- **Canonical one-liner** — `curl -fsSL https://raw.githubusercontent.com/turbopanel/turbopanel-dev/trunk/pull.sh | sh`

## Tilt

- **`Tiltfile`** — Workers or Deno local dev behind Caddy: Postgres (Docker) + instance (`pnpm dev` / wrangler **or** `deno run`) + co-located **daemon** + Expo web + Caddy HTTPS proxy. Run `tilt up` from the `dev/` checkout; `tilt down` removes Docker Compose resources (Ctrl+C alone does not). Uses native host tools (`pnpm`, `node`, `openssl`, `docker`, `deno`) — **no systemd** in Tilt. The daemon always runs: **Workers** mode dials Caddy over WSS (`TURBOPANEL_INSTANCE_URL`); **Deno** mode dials the instance Unix socket in `dev/.run/turbopanel/`. `scripts/daemon-serve.sh` sets `TURBOPANEL_SKIP_ORCHESTRATION=1` so Tilt dev does not run Ansible installs. The Tilt nav bar includes **Switch to Deno Mode** / **Switch to Workers Mode** buttons (`ext://uibutton`) that update `TURBOPANEL_INSTANCE_RUNTIME` in `dev/.env`, re-sync env, recreate Caddy, and restart the instance and daemon resources. `scripts/instance-serve.sh` checks for Deno before starting the Deno instance and exports `TURBOPANEL_DEV_HOST_AUTH=group-only` so the install wizard verifies sudo/admin group membership without calling pamtester.
- **`dev/.env`** — single source of truth for local dev variables (copy from `.env.example`). Gitignored; never commit secrets.
- **`scripts/sync-env.sh`** — run by the `env-sync` Tilt resource; writes `instance/.dev.vars`, `instance/.env`, and `docker/.env` from `dev/.env`.
- **`docker/postgres.compose.yml`** — dev Postgres on `127.0.0.1:5432`; data directory is `dev/.postgresql/` (bind mount, not a Docker volume). Credentials come from `docker/.env` (synced from `dev/.env`). `sync-env.sh` creates `.postgresql/` and writes `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` and `TURBOPANEL_DATABASE_URL` to `instance/.env` (derived from `POSTGRES_*` unless overridden) so `wrangler dev` connects locally per [Hyperdrive local dev docs](https://developers.cloudflare.com/hyperdrive/configuration/local-development/) — no credentials in `wrangler.jsonc`.
- **`docker/caddy.compose.yml`** — Caddy in Docker (proxies to host wrangler/Expo via `host.docker.internal`). Published on host port **8443**.
- **`docker/Caddyfile`** — used by the Docker Caddy service; `/api/*` and `/ws/*` → host wrangler port (workers) or mounted Unix socket (deno); UI → host Expo when `TURBOPANEL_UI_MODE=dev`. Differs from `instance/Caddyfile` (Deno Unix socket on managed hosts).
- **First run:** `tilt up` runs `scripts/init-env.mjs` to create `dev/.env` from `.env.example` and auto-fill missing secrets/defaults (same pattern as old monorepo `scripts/init-env.mjs`).
- **Resources:** `env-sync` → `postgres` + `caddy` (Docker) / `instance-deps` / `ui-deps` / `website-deps` / `instance-certs` → `instance-db` → `instance` + `ui` + `website` (caddy waits for certs + upstreams). **`instance`**, **`ui`**, **`website`**, and **`daemon`** use the **`1_platform`** Tilt label (core product services at the top of the UI).
- Website (`pnpm dev` / Next.js) runs on port **19820** (`WEBSITE_PORT` in `dev/.env`).

## Purpose of each sibling repo

**`instance/`** — The core TurboPanel server (`turbopanel/turbopanel`). Handles the main application logic, API surface, and orchestration of the panel itself.

**`ui/`** — The frontend application (`turbopanel/turbopanel-ui`). The user-facing web interface for TurboPanel, served by the instance.

**`daemon/`** — The host daemon (`turbopanel/turbopanel-daemon`). A low-level service that runs on the host machine and communicates with the panel instance to manage system-level operations.

**`website/`** — The marketing and docs site (`turbopanel/turbopanel-website`). Runs via `pnpm dev` on port **19820**; started by Tilt as the `website` resource (depends on `website-deps` and `instance`). Exposes `/docs/api` (Scalar via the instance's `/api/openapi.json`) and `/api/reference` (direct Scalar on the instance).

**`dev/`** — This repository. Contains `pull.sh`, Tilt orchestration, documentation, and any shared developer tooling that spans all sibling repos.

## Key conventions for agents

- **Default branch is `trunk`** across all sibling repos — never assume `main` or `master`.
- **`pull.sh` is the single entry point** for setting up the dev environment. Do not bypass it.
- **Never commit directly to `trunk`** — always use a feature branch and open a PR.
- **`pull.sh` is idempotent** — it skips repos with uncommitted changes rather than overwriting them.
- **Prerequisites are the developer's responsibility** — Node.js ≥ 24, pnpm ≥ 11, openssl, Docker (daemon running), Deno, and Tilt must be installed on the host before running `pull.sh`; the script only verifies presence and version, it does not install runtimes.
- **Tilt dev is Workers by default** — optional Deno runtime via `TURBOPANEL_INSTANCE_RUNTIME=deno` and the Tilt UI switch button; the co-located daemon always runs in Tilt (socket in Deno mode, WSS via Caddy in Workers mode). Do not wire systemd units into the `Tiltfile`. The instance `Caddyfile` (Unix socket + Deno on managed hosts) differs from `dev/docker/Caddyfile` (wrangler TCP or dev socket mount).

## What agents must NOT do

- Do not modify `pull.sh` without also updating the **Prerequisites** table and **Getting started** section in `README.md`.
- Do not add new sibling repos to the layout without updating both `AGENTS.md` and `README.md`.
- Do not change the default branch name in any repo without updating `pull.sh` (the `BRANCH="trunk"` variable) and both doc files.
- Do not commit secrets, credentials, or environment-specific config to any of these repos.

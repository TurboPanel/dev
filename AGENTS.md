# AGENTS.md

## What this repo is

`turbopanel-dev` is the **developer environment orchestration repository** for the TurboPanel project. It contains the idempotent bootstrap script (`pull.sh`), Tilt orchestration, shared developer documentation, and is the single source of truth for bootstrapping a local development environment.

**https://develop.trbp.nl** redirects to the GitHub repository; the bootstrap script is fetched from GitHub raw (`trunk` branch).

**Local dev targets the Cloudflare Workers runtime only** — `pnpm dev` / wrangler in `instance/`, not Deno or systemd. Caddy proxies HTTPS to wrangler (TCP) and Expo the same way the production Workers stack is meant to be exercised locally.

## Repository layout

```
turbopanel/
├── dev/      # this repo — scripts, docs, shared dev tooling
│   ├── pull.sh            # clone/update sibling repos
│   ├── Tiltfile           # Workers + Caddy Tilt orchestration
│   ├── .env.example       # local dev variable template
│   ├── scripts/
│   │   └── sync-env.sh    # dev/.env → sibling repo env files
│   └── docker/
│       ├── postgres.compose.yml  # local Postgres for Hyperdrive
│       ├── caddy.compose.yml     # Caddy in Docker (127.0.0.1:8443 publish)
│       └── Caddyfile             # HTTPS proxy → host wrangler + Expo
├── instance/ # turbopanel/turbopanel — core server (Workers entry: src/workers.ts)
├── ui/       # turbopanel/turbopanel-ui — frontend
├── daemon/   # turbopanel/turbopanel-daemon — host daemon (not started by Tilt)
└── website/  # turbopanel/turbopanel-website — marketing site (not started by Tilt)
```

## Bootstrap script

- **`pull.sh`** — clones/updates sibling repos; contributors run it with `sh pull.sh`.
- **Canonical one-liner** — `curl -fsSL https://raw.githubusercontent.com/turbopanel/turbopanel-dev/trunk/pull.sh | sh`

## Tilt

- **`Tiltfile`** — Workers local dev behind Caddy: Postgres (Docker) + `pnpm dev` (wrangler) + Expo web + Caddy HTTPS proxy. Run `tilt up` from the `dev/` checkout. Uses native host tools only (`pnpm`, `node`, `docker`) — **no Deno, no systemd, no daemon**.
- **`dev/.env`** — single source of truth for local dev variables (copy from `.env.example`). Gitignored; never commit secrets.
- **`scripts/sync-env.sh`** — run by the `env-sync` Tilt resource; writes `instance/.dev.vars`, `instance/.env`, and `docker/.env` from `dev/.env`.
- **`docker/postgres.compose.yml`** — dev Postgres on `127.0.0.1:5432`; credentials come from `docker/.env` (synced from `dev/.env`). Must stay aligned with `instance/wrangler.jsonc` Hyperdrive `localConnectionString`.
- **`docker/caddy.compose.yml`** — Caddy in Docker (proxies to host wrangler/Expo via `host.docker.internal`). Published on host port **8443**.
- **`docker/Caddyfile`** — used by the Docker Caddy service; `/api/*` and `/ws/*` → host wrangler port; UI → host Expo when `TURBOPANEL_UI_MODE=dev`. Differs from `instance/Caddyfile` (Deno Unix socket).
- **First run:** `cp .env.example .env` in the `dev/` checkout.
- **Resources:** `env-sync` → `postgres` + `caddy` (Docker) / `instance-deps` / `ui-deps` / `instance-certs` → `instance-db` → `instance` + `ui` (caddy waits for certs + upstreams).

## Purpose of each sibling repo

**`instance/`** — The core TurboPanel server (`turbopanel/turbopanel`). Handles the main application logic, API surface, and orchestration of the panel itself.

**`ui/`** — The frontend application (`turbopanel/turbopanel-ui`). The user-facing web interface for TurboPanel, served by the instance.

**`daemon/`** — The host daemon (`turbopanel/turbopanel-daemon`). A low-level service that runs on the host machine and communicates with the panel instance to manage system-level operations.

**`website/`** — The marketing site (`turbopanel/turbopanel-website`). Not wired into Tilt local dev.

**`dev/`** — This repository. Contains `pull.sh`, Tilt orchestration, documentation, and any shared developer tooling that spans all sibling repos.

## Key conventions for agents

- **Default branch is `trunk`** across all sibling repos — never assume `main` or `master`.
- **`pull.sh` is the single entry point** for setting up the dev environment. Do not bypass it.
- **Never commit directly to `trunk`** — always use a feature branch and open a PR.
- **`pull.sh` is idempotent** — it skips repos with uncommitted changes rather than overwriting them.
- **Prerequisites are the developer's responsibility** — Node.js ≥ 24, pnpm ≥ 11, Docker (daemon running), and Tilt must be installed on the host before running `pull.sh`; the script only verifies presence and version, it does not install runtimes.
- **Tilt dev is Workers-only** — do not wire Deno, `pull.sh`, or systemd units into the `Tiltfile`. The instance `Caddyfile` (Unix socket + Deno) is for self-hosted installs; `dev/docker/Caddyfile` is for wrangler TCP.

## What agents must NOT do

- Do not modify `pull.sh` without also updating the **Prerequisites** table and **Getting started** section in `README.md`.
- Do not add new sibling repos to the layout without updating both `AGENTS.md` and `README.md`.
- Do not change the default branch name in any repo without updating `pull.sh` (the `BRANCH="trunk"` variable) and both doc files.
- Do not commit secrets, credentials, or environment-specific config to any of these repos.

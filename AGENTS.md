# AGENTS.md

## What this repo is

`turbopanel-dev` is the **developer environment orchestration repository** for the TurboPanel project. It contains the idempotent bootstrap script (`src/develop/idempotent.sh`), a Cloudflare Worker that serves it, Tilt orchestration, shared developer documentation, and is the single source of truth for bootstrapping a local development environment.

**Local dev targets the Cloudflare Workers runtime only** — `pnpm dev` / wrangler in `instance/`, not Deno or systemd. Caddy proxies HTTPS to wrangler (TCP) and Expo the same way the production Workers stack is meant to be exercised locally.

## Repository layout

```
turbopanel/
├── dev/      # this repo — scripts, docs, shared dev tooling
│   ├── Tiltfile           # delegates to src/Tiltfile
│   ├── .env.example       # local dev variable template
│   ├── scripts/
│   │   └── sync-env.sh    # dev/.env → sibling repo env files
│   └── docker/
│       ├── postgres.compose.yml  # local Postgres for Hyperdrive
│       ├── caddy.compose.yml     # Caddy in Docker (127.0.0.1:8443 publish)
│       └── Caddyfile             # HTTPS proxy → host wrangler + Expo
│   └── src/
│       ├── develop/
│       │   └── idempotent.sh   # bootstrap script (also served by the Worker)
│       ├── workers/
│       │   └── index.ts        # Cloudflare Worker entry point
│       └── Tiltfile            # Workers + Caddy Tilt orchestration
├── instance/ # turbopanel/turbopanel — core server (Workers entry: src/workers.ts)
├── ui/       # turbopanel/turbopanel-ui — frontend
└── daemon/   # turbopanel/turbopanel-daemon — host daemon (not started by Tilt)
```

## Cloudflare Worker

The `dev/` repo is also a Cloudflare Worker (`turbopanel-dev`) deployed at **https://develop.trbp.nl**. The Worker serves the bundled contents of `src/develop/idempotent.sh` as `text/plain` — no runtime file I/O.

- **`src/develop/`** — `idempotent.sh` clones/updates sibling repos; contributors run it with `bash src/develop/idempotent.sh`.
- **`src/workers/`** — Worker entry point (`src/workers/index.ts`); imports the script at bundle time via Wrangler `rules` (`.sh` → `Text`).
- **Local dev / deploy** — `pnpm install`, then `pnpm dev` (Wrangler dev) or `pnpm deploy`.
- **Canonical one-liner** — `curl -fsSL https://develop.trbp.nl | bash` (pinned URL; do not point users at raw GitHub URLs).

## Tilt

- **Repo-root `Tiltfile`** — thin wrapper: `include('./src/Tiltfile')`. Run `tilt up` from the `dev/` checkout.
- **`dev/.env`** — single source of truth for local dev variables (copy from `.env.example`). Gitignored; never commit secrets.
- **`scripts/sync-env.sh`** — run by the `env-sync` Tilt resource; writes `instance/.dev.vars`, `instance/.env`, and `docker/.env` from `dev/.env`.
- **`src/Tiltfile`** — Workers local dev behind Caddy: Postgres (Docker) + `pnpm dev` (wrangler) + Expo web + Caddy HTTPS proxy. Uses native host tools only (`pnpm`, `node`, `docker`) — **no Deno, no systemd, no daemon**.
- **`docker/postgres.compose.yml`** — dev Postgres on `127.0.0.1:5432`; credentials come from `docker/.env` (synced from `dev/.env`). Must stay aligned with `instance/wrangler.jsonc` Hyperdrive `localConnectionString`.
- **`docker/caddy.compose.yml`** — Caddy in Docker (proxies to host wrangler/Expo via `host.docker.internal`). Published on host port **8443**.
- **Cursor Ports panel** — Cursor auto-forwards **Tilt (10350)** only, not Docker publishes. Use **`.devcontainer/devcontainer.json`** (`forwardPorts: [8443, …]`) + **Reopen in Container**, or manually forward **8443** once in Ports.
- **`docker/Caddyfile`** — used by the Docker Caddy service; `/api/*` and `/ws/*` → host wrangler port; UI → host Expo when `TURBOPANEL_UI_MODE=dev`. Differs from `instance/Caddyfile` (Deno Unix socket).
- **First run:** `cp .env.example .env` in the `dev/` checkout.
- **Resources:** `env-sync` → `postgres` + `caddy` (Docker) / `instance-deps` / `ui-deps` / `instance-certs` → `instance-db` → `instance` + `ui` (caddy waits for certs + upstreams).

## Purpose of each sibling repo

**`instance/`** — The core TurboPanel server (`turbopanel/turbopanel`). Handles the main application logic, API surface, and orchestration of the panel itself.

**`ui/`** — The frontend application (`turbopanel/turbopanel-ui`). The user-facing web interface for TurboPanel, served by the instance.

**`daemon/`** — The host daemon (`turbopanel/turbopanel-daemon`). A low-level service that runs on the host machine and communicates with the panel instance to manage system-level operations.

**`dev/`** — This repository. Contains `src/develop/idempotent.sh`, the Cloudflare Worker that serves it, Tilt orchestration, documentation, and any shared developer tooling that spans all sibling repos.

## Key conventions for agents

- **Default branch is `trunk`** across all four repos — never assume `main` or `master`.
- **`src/develop/idempotent.sh` is the single entry point** for setting up the dev environment. Do not bypass it.
- **Never commit directly to `trunk`** — always use a feature branch and open a PR.
- **`src/develop/idempotent.sh` is idempotent** — it skips repos with uncommitted changes rather than overwriting them.
- **Prerequisites are the developer's responsibility** — Node.js ≥ 24, pnpm ≥ 11, Docker (daemon running), and Tilt must be installed on the host before running `src/develop/idempotent.sh`; the script only verifies presence and version, it does not install runtimes.
- **Tilt dev is Workers-only** — do not wire Deno, `develop.sh`, or systemd units into `src/Tiltfile`. The instance `Caddyfile` (Unix socket + Deno) is for self-hosted installs; `dev/docker/Caddyfile` is for wrangler TCP.

## What agents must NOT do

- Do not modify `src/develop/idempotent.sh` without also updating the **Prerequisites** table and **Getting started** section in `README.md`.
- Do not add new sibling repos to the layout without updating both `AGENTS.md` and `README.md`.
- Do not change the default branch name in any repo without updating `src/develop/idempotent.sh` (the `BRANCH="trunk"` variable) and both doc files.
- Do not commit secrets, credentials, or environment-specific config to any of these repos.

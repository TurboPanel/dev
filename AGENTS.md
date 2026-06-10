# AGENTS.md

## What this repo is

`turbopanel-dev` is the **developer environment orchestration repository** for the TurboPanel project. It contains the idempotent bootstrap script (`src/develop/idempotent.sh`), a Cloudflare Worker that serves it, Tilt orchestration, shared developer documentation, and is the single source of truth for bootstrapping a local development environment.

## Repository layout

```
turbopanel/
├── dev/      # this repo — scripts, docs, shared dev tooling
│   ├── Tiltfile           # delegates to src/Tiltfile
│   └── src/
│       ├── develop/
│       │   └── idempotent.sh   # bootstrap script (also served by the Worker)
│       ├── workers/
│       │   └── index.ts        # Cloudflare Worker entry point
│       └── Tiltfile            # Tilt dev orchestration entrypoint
├── instance/ # turbopanel/turbopanel — core server
├── ui/       # turbopanel/turbopanel-ui — frontend
└── daemon/   # turbopanel/turbopanel-daemon — host daemon
```

## Cloudflare Worker

The `dev/` repo is also a Cloudflare Worker (`turbopanel-dev`) deployed at **https://develop.trbp.nl**. The Worker serves the bundled contents of `src/develop/idempotent.sh` as `text/plain` — no runtime file I/O.

- **`src/develop/`** — `idempotent.sh` clones/updates sibling repos; contributors run it with `bash src/develop/idempotent.sh`.
- **`src/workers/`** — Worker entry point (`src/workers/index.ts`); imports the script at bundle time via Wrangler `rules` (`.sh` → `Text`).
- **Local dev / deploy** — `pnpm install`, then `pnpm dev` (Wrangler dev) or `pnpm deploy`.
- **Canonical one-liner** — `curl -fsSL https://develop.trbp.nl | bash` (pinned URL; do not point users at raw GitHub URLs).

## Tilt

- **Repo-root `Tiltfile`** — thin wrapper: `include('./src/Tiltfile')`. Run `tilt up` from the `dev/` checkout.
- **`src/Tiltfile`** — canonical Tilt entrypoint for local dev orchestration across sibling repos.

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
- **Prerequisites are the developer's responsibility** — Node.js ≥ 24, Deno ≥ 2.x, Docker (daemon running), and Tilt must be installed on the host before running `src/develop/idempotent.sh`; the script only verifies presence and version, it does not install runtimes.

## What agents must NOT do

- Do not modify `src/develop/idempotent.sh` without also updating the **Prerequisites** table and **Getting started** section in `README.md`.
- Do not add new sibling repos to the layout without updating both `AGENTS.md` and `README.md`.
- Do not change the default branch name in any repo without updating `src/develop/idempotent.sh` (the `BRANCH="trunk"` variable) and both doc files.
- Do not commit secrets, credentials, or environment-specific config to any of these repos.

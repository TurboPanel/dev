# AGENTS.md

## What this repo is

`turbopanel-dev` is the **developer environment orchestration repository** for the TurboPanel project. It contains the setup script (`develop.sh`), shared developer documentation, and is the single source of truth for bootstrapping a local development environment.

## Repository layout

```
turbopanel/
├── dev/      # this repo — scripts, docs, shared dev tooling
├── instance/ # turbopanel/turbopanel — core server
├── ui/       # turbopanel/turbopanel-ui — frontend
└── daemon/   # turbopanel/turbopanel-daemon — host daemon
```

## Purpose of each sibling repo

**`instance/`** — The core TurboPanel server (`turbopanel/turbopanel`). Handles the main application logic, API surface, and orchestration of the panel itself.

**`ui/`** — The frontend application (`turbopanel/turbopanel-ui`). The user-facing web interface for TurboPanel, served by the instance.

**`daemon/`** — The host daemon (`turbopanel/turbopanel-daemon`). A low-level service that runs on the host machine and communicates with the panel instance to manage system-level operations.

**`dev/`** — This repository. Contains `develop.sh`, documentation, and any shared developer tooling that spans all sibling repos.

## Key conventions for agents

- **Default branch is `trunk`** across all four repos — never assume `main` or `master`.
- **`develop.sh` is the single entry point** for setting up the dev environment. Do not bypass it.
- **Never commit directly to `trunk`** — always use a feature branch and open a PR.
- **`develop.sh` is idempotent** — it skips repos with uncommitted changes rather than overwriting them.
- **Prerequisites are the developer’s responsibility** — Node.js ≥ 24, Deno ≥ 2.x, Docker (daemon running), and Tilt must be installed on the host before running `develop.sh`; the script only verifies presence and version, it does not install runtimes.

## What agents must NOT do

- Do not modify `develop.sh` without also updating the **Prerequisites** table and **Getting started** section in `README.md`.
- Do not add new sibling repos to the layout without updating both `AGENTS.md` and `README.md`.
- Do not change the default branch name in any repo without updating `develop.sh` (the `BRANCH="trunk"` variable) and both doc files.
- Do not commit secrets, credentials, or environment-specific config to any of these repos.

# AGENTS.md

## What this repo is

`turbopanel-dev` is the **TurboPanel development console** — a Deno CLI with an Ink-style terminal UI (`@deno-ink/core`). It is installed via a one-liner into `./turbopanel-dev` relative to the user's current directory. The console orchestrates development from that checkout.

**Target host:** Debian 13 (Vagrant support planned).

**Bootstrap URL:** https://develop.trbp.nl → `scripts/install.sh` on the `trunk` branch.

## Filesystem layout

```
~/…/turbopanel-dev/       # ./turbopanel-dev from scripts/install.sh (user's cwd)
├── console               # runtime install + launch console
├── scripts/install.sh    # clone/update this repo only
├── deno.json
└── src/
/opt/turbopanel/
├── platform/             # daemon (from console); instance/ui installed by daemon via Ansible
└── runtimes/
    └── deno/
        └── v2.8.3/
            └── bin/deno
```

## Entry points

| Script | Purpose |
|--------|---------|
| `curl -fsSL https://develop.trbp.nl \| sh` | Clone/update `./turbopanel-dev` via SSH. |
| `sh scripts/install.sh` | Same when run from inside the repo to update the checkout. |
| `./console` | Install Deno runtime if missing (sudo), cache deps, launch Ink console (`deno task dev`). |
| Start dev stack (console action) | Writes daemon `.env`, bootstraps orchestration, installs systemd unit, tails journals. |

**Typical flow:**

```bash
curl -fsSL https://develop.trbp.nl | sh
cd turbopanel-dev
./console
```

## Responsibilities

- **`scripts/install.sh`** — clones/updates **only** `turbopanel-dev` via `git@github.com:turbopanel/turbopanel-dev.git`. No sudo, no Deno, no platform repos.
- **`console`** — ensures Deno is installed under `/opt/turbopanel/runtimes` (sudo on first run), caches dependencies, starts the console.
- **Ink console** — installs the **daemon** repo only via SSH; writes developer identity (`TURBOPANEL_DEV_USER/UID/GID`) into the daemon `.env`; runs `bootstrap-orchestration.sh` and `install-daemon-systemd.sh` to hand off to the daemon, which installs everything else via Ansible.

## Deno app

- **`deno.json`** — tasks, imports (`@deno-ink/core`, React 18).
- **`src/main.tsx`** — entry; renders the Ink app.
- **`src/app.tsx`** — unified Ink console (runtime/platform status, dev stack actions, developer sections when instance.sock is present).
- **`src/developer-console.tsx`** — developer section sidebar + panel renderer (`DeveloperPanels`), embedded by `app.tsx`.
- **`src/instance-client.ts`** — HTTP client for the instance API (Unix socket + HTTPS fallback).
- **`src/use-developer-state.ts`** — shared 2 s polling hook for fleet/health/events/commands.
- **`src/sections/`** — Ink section components (fleet, services, network, shell, connectivity, database, servers).
- **`src/paths.ts`** — shared path constants and platform repo checks.

Keep the CLI **simple**. Platform repo install, service monitoring, and updates belong in the Ink app — not new shell scripts.

## Developer console

The developer console is not a separate Ink view — it is part of `./console`. Use **←** / **→** to switch areas:

| Area | Contents |
|------|----------|
| **Status** | Runtime, platform checkout, dev stack units |
| **Instance** | Runtime mode (Deno/Workers), instance unit status, switch action |
| **Developer** | Fleet, services, shell, database, … (when `instance.sock` is present) |
| **Actions** | Install daemon, start stack, follow logs, build mode, refresh, quit |

Only one area is visible at a time — no scrolling past status + sections + menu on one screen.

In the **Developer** area: **↑↓** picks a section, **Enter** opens it, **Esc** returns to the section list. Section panels then own their own keys (↑↓ actions in Fleet, `i` to type in Shell, etc.).

### Sections

| Section | Purpose | Keys |
|---------|---------|------|
| Fleet | Health, connected nodes, upgrade/sync/tunnel actions | ↑↓ actions · Enter |
| Services | systemd units, Postgres container, socket presence | (polls every 5 s) |
| Network | Interface IP addresses | Enter fetch |
| Shell | Remote commands on target | type command · Enter run |
| Connectivity | WS event log + broadcast ping | b or Enter broadcast |
| Database | Postgres test, Drizzle Studio, reset dev | ↑↓ actions · Enter · y/N confirm reset |
| Servers | Register servers, assign orgs | a/e/o · ↑↓ select |

Navigate sections with **↑↓**, **Enter** to open, **Esc** to return to the list. **t** cycles daemon target (`all servers` or per-host). **← →** switches areas. **q** / **Esc** (when not inside a section) quits the console.

### Instance runtime env vars

`TURBOPANEL_INSTANCE_RUNTIME` in the daemon `.env` selects how the instance runs locally:

| Value | Behaviour |
|-------|-----------|
| `deno` (default) | `turbopanel-instance` systemd unit + Unix socket at `/run/turbopanel/instance.sock` |
| `workers` | Stops the systemd unit, re-runs Postgres with TCP (`postgres_expose_port=true` on `127.0.0.1:5432`), and expects `pnpm dev` in `platform/instance` manually |

Workers mode has no Redis. `ensureWorkersDevVars()` writes both `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` (for the Hyperdrive runtime binding) and `TURBOPANEL_DATABASE_URL` (for `drizzle-kit migrate`) to `instance/.env`. Switch via the **Instance** area in the console.

### API client (`src/instance-client.ts`)

Single choke-point for `/api/developer/v1/*` and `/api/health`:

1. **Primary:** raw HTTP/1.1 over Unix socket `/run/turbopanel/instance.sock`
2. **Fallback:** `https://localhost:8443` with platform CA from `/opt/turbopanel/platform/instance/certs/ca.crt` (or permissive TLS if CA missing)

### Polling (`src/use-developer-state.ts`)

Polls every 2 s (same endpoints as the retired Expo `DeveloperProvider`): `/api/health`, `/api/developer/v1/daemon/connections`, `…/events`, `…/commands`.

## Shell libraries

- **`scripts/lib/privileges.sh`** — POSIX sudo re-exec helpers (`tp_ensure_privileges`).
- **`scripts/lib/paths.sh`** — `/opt/turbopanel` path constants.
- **`scripts/lib/runtime.sh`** — Deno runtime install (`tp_ensure_deno_runtime`).

## Key conventions

- Default git branch is **`trunk`** everywhere.
- Shell scripts are **POSIX `sh`** — no bashisms.
- Git clones use **SSH** (`git@github.com:turbopanel/...`), not HTTPS.
- **`scripts/install.sh` only installs this repo** — no runtime, no platform repos.
- **`console` owns the Deno runtime** and starting the console.
- **`turbopanel-dev` installs to `./turbopanel-dev`** in the user's cwd.
- The console installs **only** the daemon repo. All other platform repos (instance, ui, website) are installed by the daemon via Ansible (`instance-dev-install.yml`).
- Developer identity (`TURBOPANEL_DEV_USER`, `TURBOPANEL_DEV_UID`, `TURBOPANEL_DEV_GID`) is resolved from the **process UID** via `getent passwd` (`resolveDevIdentity()` in `src/paths.ts`, `tp_resolve_dev_identity()` in `scripts/lib/dev-identity.sh`). **`USER` / `LOGNAME` are never trusted.** Unresolved identities and `root` are rejected; the only root exception is a validated `SUDO_USER` passwd entry when the console runs under `sudo`. The dev stack refuses to write `TURBOPANEL_DEV_*` or run Ansible when identity cannot be resolved cleanly.
- Do not commit secrets or environment-specific config.

## What agents must NOT do

- Do not add Deno install, dependency caching, or sudo to `scripts/install.sh`.
- Do not add platform repo cloning to shell scripts — that belongs in the console.
- Do not add instance/ui/website repo cloning to the console — the daemon owns those via Ansible.
- Do not hardcode developer UID/GID — always read from `resolveDevIdentity()` (or `getDevUser()`/`getDevUid()`/`getDevGid()` wrappers) in `src/paths.ts`, or `tp_require_dev_identity()` in shell scripts.
- Do not reintroduce `pull.sh`.
- Do not clone `turbopanel-dev` into `/opt/turbopanel/platform`.
- Do not add PATH symlinks, `env.sh`, or profile hooks — `console` runs Deno from `/opt/turbopanel/runtimes/deno/v2.8.3/bin/deno` directly.
- Do not bump the pinned Deno version without updating `scripts/lib/paths.sh`, `src/paths.ts`, and docs. The next `./console` run installs the new version and removes older `v*` directories under `/opt/turbopanel/runtimes/deno`.
- Do not commit directly to `trunk` — use a feature branch and open a PR.

## Legacy runtime directory

Older checkouts installed Deno under `/opt/turbopanel/runtime` (singular). Current layout uses `/opt/turbopanel/runtimes/deno/v<DENO_VERSION>/`. If you still have the old tree after upgrading, remove it manually once the new runtime works:

```bash
sudo rm -rf /opt/turbopanel/runtime
```

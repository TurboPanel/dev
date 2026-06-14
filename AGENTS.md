# AGENTS.md

## What this repo is

`turbopanel-dev` is the **TurboPanel development console** — a Deno CLI with an Ink-style terminal UI (`@deno-ink/core`). It is installed via a one-liner into `./turbopanel-dev` relative to the user's current directory. The console orchestrates development from that checkout.

This replaces the old Tilt-based workflow in `old/`.

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
├── platform/             # instance, ui, daemon, website (future — from console)
└── runtime/
    └── deno/
        └── v2.8.2/
            └── bin/deno
```

## Entry points

| Script | Purpose |
|--------|---------|
| `curl -fsSL https://develop.trbp.nl \| sh` | Clone/update `./turbopanel-dev` via SSH. |
| `sh scripts/install.sh` | Same when run from inside the repo to update the checkout. |
| `./console` | Install Deno runtime if missing (sudo), cache deps, launch Ink console (`deno task dev`). |

**Typical flow:**

```bash
curl -fsSL https://develop.trbp.nl | sh
cd turbopanel-dev
./console
```

## Responsibilities

- **`scripts/install.sh`** — clones/updates **only** `turbopanel-dev` via `git@github.com:turbopanel/turbopanel-dev.git`. No sudo, no Deno, no platform repos.
- **`console`** — ensures Deno is installed under `/opt/turbopanel/runtime` (sudo on first run), caches dependencies, starts the console.
- **Ink console** — installs platform repos via SSH (`git@github.com:turbopanel/...`), prompts for sudo when `/opt/turbopanel/platform` is not writable.

## Deno app

- **`deno.json`** — tasks, imports (`@deno-ink/core`, React 18).
- **`src/main.tsx`** — entry; renders the Ink app.
- **`src/app.tsx`** — developer console UI (runtime + platform status for now).
- **`src/paths.ts`** — shared path constants and platform repo checks.

Keep the CLI **simple**. Platform repo install, service monitoring, and updates belong in the Ink app — not new shell scripts.

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
- Do not commit secrets or environment-specific config.
- `old/` is reference only — do not extend unless explicitly asked.

## What agents must NOT do

- Do not add Deno install, dependency caching, or sudo to `scripts/install.sh`.
- Do not add platform repo cloning to shell scripts — that belongs in the console.
- Do not reintroduce `pull.sh`.
- Do not clone `turbopanel-dev` into `/opt/turbopanel/platform`.
- Do not add PATH symlinks, `env.sh`, or profile hooks — `console` runs Deno from `/opt/turbopanel/runtime/deno/v2.8.2/bin/deno` directly.
- Do not bump the pinned Deno version without updating `scripts/lib/paths.sh`, `src/paths.ts`, and docs.
- Do not commit directly to `trunk` — use a feature branch and open a PR.

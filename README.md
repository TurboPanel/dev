# turbopanel-dev

Development environment for [TurboPanel](https://github.com/turbopanel/turbopanel)

## Getting started

```sh
curl -fsSL https://trbp.nl/develop.sh | sh
```

That one-liner downloads `scripts/develop.sh`, clones or updates this repo into `./turbopanel-dev`, installs the pinned **Node** runtime (used to run this console) to `/usr/local` when needed, runs `pnpm install`, and starts the developer console via `vite-node`. On first run it may prompt for git identity, GitHub SSH setup, and sudo (for `git`, `openssh-client`, and the Node install). You can optionally configure passwordless sudo for your dev user to avoid repeated password prompts.

**Deno** is not installed or managed by this repo for the console itself. Install Deno on your host for daemon bootstrap during development, or let daemon bootstrap install it to `/usr/local/bin/deno`. Production hosts use the same system binary or a compiled bootstrap entrypoint when `TURBOPANEL_RUNTIME=production`.

The console is an [Ink](https://github.com/vadimdemedes/ink) TUI run on Node via Vite. Use `./console --watch` (or `pnpm dev:watch`) for live reload while editing; the watch runner keeps Ink mounted and rerenders when files under `src/` change.

## Prerequisites

Debian 13, interactive terminal, `curl`, `sudo`, a sudo-capable development user, and **Deno on PATH** (or let the dev stack install the pinned **`2.9.0`** runtime under `/opt/turbopanel/lib/runtime/deno/`).

## Fresh-clone → working dev

1. Clone the five repos into `$HOME` (`~/dev`, `~/daemon`, `~/instance`, `~/ui`, `~/website`).
2. From `~/dev`, run `./console` → prereqs, pinned Node **`24.17.0`**, `pnpm install`, TUI launch (exports `TURBOPANEL_MODE=development`, `TURBOPANEL_DEV_ROOT`, `TURBOPANEL_<DIR>_REPO`).
3. **Start dev stack** → daemon bootstraps as the dev user, writes `/etc/turbopanel/daemon.env`, runs the `dev/orchestration` overlay: runtimes into `/opt/turbopanel/lib/runtime`, systemd units + Docker (postgres/redis/rabbitmq/mailpit) as the dev user, mutable data under FHS trees dev-user-owned. No `turbopanel` / `turbopaneli` / `turbopanelc` accounts created.
4. Open `https://localhost:8443` (or dev `http://localhost:8880`); edit source in place under `$HOME`.

See [Local development](https://turbopanel.io/docs/getting-started/development) for ports, runtime modes, and troubleshooting.

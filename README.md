# turbopanel-dev

Development environment for [TurboPanel](https://github.com/turbopanel/turbopanel)

## Getting started

```sh
curl -fsSL https://develop.trbp.nl | sh
```

That one-liner downloads `scripts/develop.sh`, clones or updates this repo into `./turbopanel-dev`, installs the pinned **Node** runtime (used to run this console) to `/usr/local` when needed, runs `pnpm install`, and starts the developer console via `vite-node`. On first run it may prompt for git identity, GitHub SSH setup, and sudo (for `git`, `openssh-client`, and the Node install). You can optionally configure passwordless sudo for your dev user to avoid repeated password prompts.

**Deno** is not installed or managed by this repo for the console itself. Install Deno on your host for daemon bootstrap during development, or let daemon bootstrap install it to `/usr/local/bin/deno`. Production hosts use the same system binary or a compiled bootstrap entrypoint when `TURBOPANEL_RUNTIME=production`.

The console is an [Ink](https://github.com/vadimdemedes/ink) TUI run on Node via Vite. Use `./console --watch` (or `pnpm dev:watch`) for live reload while editing; the watch runner keeps Ink mounted and rerenders when files under `src/` change.

**Prerequisites:** Debian 13, interactive terminal, `curl`, `sudo`, a sudo-capable development user, and **Deno on PATH** for daemon bootstrap.

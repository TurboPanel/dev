# turbopanel-dev

Development environment for [TurboPanel](https://github.com/turbopanel/turbopanel)

## Getting started

```sh
curl -fsSL https://develop.trbp.nl | sh
```

That one-liner downloads `scripts/develop.sh`, clones or updates this repo into `./turbopanel-dev`, installs the pinned **Node** (used to run this console) and pinned **Deno** (used by the daemon/instance) to `/usr/local` when needed, runs `pnpm install`, and starts the developer console via `vite-node`. On first run it may prompt for git identity, GitHub SSH setup, and sudo (for `git`, `openssh-client`, and the runtime installs). You can optionally configure passwordless sudo for your dev user to avoid repeated password prompts.

The console is an [Ink](https://github.com/vadimdemedes/ink) TUI run on Node via Vite. Use `./console --watch` (or `pnpm dev:watch`) for live reload while editing; the watch runner keeps Ink mounted and rerenders when files under `src/` change.

**Prerequisites:** Debian 13, interactive terminal, `curl`, `sudo`, and a sudo-capable development user.

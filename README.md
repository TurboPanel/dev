# turbopanel-dev

## Project overview

TurboPanel is a self-hosted server management panel. This `dev` repository is the starting point for contributors — it bootstraps all sibling repositories and provides the tooling needed to run the full stack locally.

## Prerequisites

**You are responsible for installing these runtimes on your machine before running the bootstrap script.** The setup script checks that each tool is present and meets the minimum version, but it does not install them for you.

| Tool | Minimum version | Install |
|------|-----------------|---------|
| Node.js | 24.x | https://nodejs.org |
| Deno | 2.x | https://deno.land/#installation |
| Docker | latest stable (daemon must be running) | https://docs.docker.com/get-docker/ |
| Tilt | latest stable | https://docs.tilt.dev/install.html |

## Getting started

**One-liner (fresh machine):**

```bash
curl -fsSL https://develop.trbp.nl | bash
```

**If you have already cloned this repo:**

```bash
bash src/develop/idempotent.sh
```

After sibling repos are present, start local dev orchestration from the `dev/` checkout:

```bash
tilt up
```

When run from an existing `turbopanel-dev` checkout, the script uses the checkout’s parent directory as the install root automatically (for example, if your checkout is at `~/turbopanel/dev`, sibling repos are created under `~/turbopanel/`). It does not prompt in that mode.

For piped or standalone runs (such as the one-liner above), the script may prompt for an install directory (default: `~/turbopanel`) when a terminal is available, or fall back to `~/turbopanel` when there is no controlling terminal.

In all cases, the script clones or updates the sibling repos under the chosen install root.

## Repository layout

```
turbopanel/
├── dev/      # this repo — scripts, docs, shared dev tooling
├── instance/ # turbopanel/turbopanel — core server
├── ui/       # turbopanel/turbopanel-ui — frontend
└── daemon/   # turbopanel/turbopanel-daemon — host daemon
```

## Branch conventions

All repositories use **`trunk`** as the default and integration branch. Do not use `main` or `master`.

## Updating

Re-running `src/develop/idempotent.sh` is safe. For each repo it will:

- **Skip** the repo if there are any uncommitted changes, printing a warning.
- **Pull** the latest `trunk` with `--ff-only` if the working tree is clean.

## Contributing

Create a feature branch off `trunk`, make your changes, then open a pull request back to `trunk`. Do not push directly to `trunk`.

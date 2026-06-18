# turbopanel-dev

Development environment for [TurboPanel](https://github.com/turbopanel/instance). A Deno CLI with an Ink-style terminal UI for bootstrapping and working on a Debian 13 VM.

## Getting started

```bash
curl -fsSL https://develop.trbp.nl | sh
cd turbopanel-dev
./console
```

The bootstrap URL pipes `scripts/develop.sh` into `sh` (no checkout on disk yet). Library helpers are downloaded from GitHub (`raw.githubusercontent.com`) for that first run; after clone, re-runs use the local `scripts/lib/` copy.

`scripts/develop.sh` clones this repo into `./turbopanel-dev` (relative to where you run the command). `./console` installs the Deno runtime on first run (sudo) and starts the developer console.

## Prerequisites

**For `scripts/develop.sh` and `./console`**

- Interactive terminal (for first-time GitHub SSH setup in `develop.sh`)
- **`curl`** installed on the host before running (`apt install curl`)
- **`sudo`** installed and the **development user** in the `sudo` group (or `wheel` / `admin`)
- `git` (installed automatically by `develop.sh` when missing, via sudo)
- SSH access to GitHub (`git@github.com:turbopanel/...`) — `develop.sh` generates `~/.ssh/id_ed25519`, shows the public key for GitHub, and configures SSH commit signing

**For `./console` only**

- `sudo` (installs `unzip` via apt if missing, then Deno on first run)

## Layout

```
~/turbopanel-dev/                    # scripts/develop.sh
├── console                          # runtime + console
├── scripts/develop.sh               # clone/update this repo only
└── src/
/opt/turbopanel/
├── platform/
│   └── instance/                    # Hono API (installed by daemon via Ansible)
└── runtimes/
    └── deno/2.8.3/deno              # console-managed Deno runtime (first run)
```

## Updating the checkout

```bash
curl -fsSL https://develop.trbp.nl | sh
```

Or from inside the repo:

```bash
sh scripts/develop.sh
```

Re-run `./console` to refresh dependencies or the runtime.

Deno is not on your PATH by design. To run it manually:

```bash
./scripts/deno.sh --version
./scripts/deno.sh task console:watch   # when editing the console UI
```

## Branch conventions

All repositories use **`trunk`** as the default branch.


# turbopanel-dev

Development environment for [TurboPanel](https://github.com/turbopanel/turbopanel). A Deno CLI with an Ink-style terminal UI for bootstrapping and working on a Debian 13 VM.

## Getting started

```bash
curl -fsSL https://develop.trbp.nl | sh
cd turbopanel-dev
./console
```

`install.sh` clones this repo into `./turbopanel-dev` (relative to where you run the command). `./console` installs the Deno runtime on first run (sudo) and starts the developer console.

## Prerequisites

**For `install.sh`**

- `git`
- SSH access to GitHub (`git@github.com:turbopanel/...`)

**For `./console`**

- `sudo` (installs `curl` and `unzip` via apt if missing, then Deno on first run)

## Layout

```
~/turbopanel-dev/                    # install.sh
├── install.sh                       # clone/update this repo only
├── console                          # runtime + console
└── src/
/opt/turbopanel/
├── platform/                        # platform repos (from console)
└── runtime/deno/v2.8.2/bin/deno     # console (first run)
```

## Updating the checkout

```bash
curl -fsSL https://develop.trbp.nl | sh
```

Or from inside the repo:

```bash
sh install.sh
```

Re-run `./console` to refresh dependencies or the runtime.

Deno is not on your PATH by design. To run it manually:

```bash
./scripts/deno.sh --version
./scripts/deno.sh task console:watch   # when editing the console UI
```

## Branch conventions

All repositories use **`trunk`** as the default branch.

## Legacy setup

The previous Tilt-based workflow lives in [`old/`](old/).

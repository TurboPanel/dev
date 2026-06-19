# turbopanel-dev

Development environment for [TurboPanel](https://github.com/turbopanel/turbopanel)

## Getting started

```sh
curl -fsSL https://develop.trbp.nl | sh
```

That one-liner downloads `scripts/develop.sh`, clones or updates this repo into `./turbopanel-dev`, installs the pinned Deno release to `/usr/local/bin/deno` when needed, and starts the developer console. On first run it may prompt for git identity, GitHub SSH setup, and sudo (for `git`, `openssh-client`, `unzip`, and Deno). You can optionally configure passwordless sudo for your dev user to avoid repeated password prompts.

**Prerequisites:** Debian 13, interactive terminal, `curl`, `sudo`, and a sudo-capable development user.

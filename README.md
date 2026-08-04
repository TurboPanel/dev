# TurboPanel Development Environment

> **Contributor tooling only — this is not the production or self-hosted install path.**
> To run TurboPanel in production or self-host the control plane, see
> **[Self-hosted overview](https://turbopanel.io/docs/deployment/self-hosted)** and
> **[Control plane deployment](https://turbopanel.io/docs/deployment/control-plane)**.

[![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-blue.svg)](./LICENSE)
[![Docs](https://img.shields.io/badge/docs-development-3366cc)](https://turbopanel.io/docs/getting-started/development)
[![Status: Private alpha](https://img.shields.io/badge/status-private%20alpha-3dd68c)](https://turbopanel.io/roadmap)

GitHub: [turbopanel/dev](https://github.com/turbopanel/dev)

## Supported contributor environment

- **Debian 13** (Trixie) recommended
- Interactive terminal with `curl` and `sudo`
- Sudo-capable development user (passwordless sudo optional — see below)
- **Deno** on PATH, or vendored Deno installed during daemon bootstrap (`2.9.4`)

## Bootstrap

```sh
curl -fsSL dev.turbopanel.sh | sh
```

That one-liner:

1. Downloads `scripts/develop.sh` from this repo
2. Clones or updates `~/dev`
3. Installs pinned **Node** `24.17.0` to `/opt/turbopanel/vendor/node/` when missing
4. Runs `pnpm install` and launches the Ink developer console (`vite-node`)

### First-run prompts

On first bootstrap the script may:

- Prompt for git `user.name` / `user.email`
- Generate `~/.ssh/id_ed25519` and verify GitHub SSH access
- Install `git` / `openssh-client` via apt (sudo)
- Offer a `/etc/sudoers.d/turbopanel-dev-nopasswd` fragment (`NOPASSWD` for the dev user)

Set `TURBOPANEL_DEV_SKIP_NOPASSWD_SUDO=1` to skip the sudoers prompt.

### What converge changes on your machine

After **Converge** in the console, expect:

| Area | Paths / effect |
| --- | --- |
| Sibling repos | `~/daemon`, `~/instance`, `~/ui`, `~/website` cloned or updated |
| FHS mutable data | `/etc/turbopanel`, `/var/lib/turbopanel`, `/var/log/turbopanel`, `/run/turbopanel` (dev-user-owned) |
| Vendored runtimes | `/opt/turbopanel/vendor/{node,deno,caddy,…}` |
| systemd units | `turbopaneld`, `turbopanel-instance`, `turbopanel-caddy`, `turbopanel-ui`, Docker-backed services |
| Local URL | `https://localhost:8443` (TLS) and `http://localhost:8880` (plaintext dev) |

No dedicated `tp` / `tpctrl` service accounts are created in dev — everything runs as your user.

## Repositories fetched

| Checkout | Repository |
| --- | --- |
| `~/dev` | [turbopanel/dev](https://github.com/turbopanel/dev) (this repo — bootstrap only) |
| `~/daemon` | [turbopanel/turbopaneld](https://github.com/turbopanel/turbopaneld) |
| `~/instance` | [turbopanel/turbopanel](https://github.com/turbopanel/turbopanel) |
| `~/ui` | [turbopanel/ui](https://github.com/turbopanel/ui) |
| `~/website` | [turbopanel/website](https://github.com/turbopanel/website) |

`develop.sh` clones **only** `~/dev`. The console clones or updates platform repos during converge.

## Further reading

- [Local development guide](https://turbopanel.io/docs/getting-started/development?utm_source=github-dev-readme)
- [Architecture](https://turbopanel.io/docs/architecture)
- [Troubleshooting](https://turbopanel.io/docs/deployment/troubleshooting)
- [Cleanup / uninstall](https://turbopanel.io/docs/deployment/uninstall#contributor-dev-environment) — reset flow in `src/lib/reset-dev-environment.ts`

## Contributing

See [CONTRIBUTING.md](https://github.com/turbopanel/.github/blob/trunk/CONTRIBUTING.md). Default branch: **`trunk`**. Feature branch + PR only.

Agent conventions: [AGENTS.md](./AGENTS.md).

## License

TurboPanel Development Environment is licensed under the [GNU Affero General Public License v3.0 only (AGPL-3.0-only)](./LICENSE).

Copyright (C) 2025 TurboPanel contributors

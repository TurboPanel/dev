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

- **Debian 13** (Trixie) recommended for bare-metal guests
- **Linux:** KVM/libvirt + Vagrant (Debian 13 / `debian/trixie64` guest)
- **macOS:** UTM + Vagrant (guest is Debian 12 / `utm/bookworm` until a Trixie UTM box is published)
- Interactive terminal with `curl` and `sudo`
- Sudo-capable development user (passwordless sudo optional — see below)
- **Deno** on PATH, or vendored Deno installed during daemon bootstrap (`2.9.5`)

## Bootstrap

### Linux (Vagrant + libvirt)

Install Vagrant, QEMU/KVM, libvirt, dnsmasq, VirtioFS, and the
[`vagrant-libvirt`](https://vagrant-libvirt.github.io/vagrant-libvirt/)
plugin. Ensure the development user belongs to the `libvirt` group and that
libvirt's default network and storage pool are active.

Clone the sibling repos in the layout shown in the macOS section below, then
run this from the `dev` checkout:

```sh
vagrant up
```

The Vagrantfile automatically selects libvirt on Linux, even when another
provider is installed, and boots the Debian 13 `debian/trixie64` box. Source
checkouts are mounted bidirectionally into the guest with VirtioFS; guest RAM
uses libvirt's in-memory `memfd` backend so VirtioFS does not cause host-disk
writeback. First provision runs apt upgrades and, when a newer kernel is
pending, **reboots the guest once** (SSH drops for about a minute — expected;
Vagrant waits and continues). To open the developer console after the guest is
ready:

```sh
vagrant ssh -- -t 'cd "$HOME/dev" && exec ./console'
```

### macOS (Vagrant + UTM)

Clone the five sibling repos side by side (for example under `~/Development/turbopanel/`). `.github` is optional — mount it if you have it checked out, otherwise Ansible clones it inside the guest automatically:

```
turbopanel/
├── dev/        # this repo (contains the Vagrantfile)
├── turbopaneld/
├── turbopanel/
├── ui/
├── website/
└── .github/    # optional — community health files
```

Host prerequisites: [Vagrant](https://developer.hashicorp.com/vagrant), [UTM](https://mac.getutm.app/), and the UTM provider plugin:

```sh
brew install --cask utm
brew install hashicorp/tap/hashicorp-vagrant
vagrant plugin install vagrant_utm
```

Load a GitHub SSH key into your host agent (forwarded into the guest):

```sh
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
```

From this repo:

```sh
./scripts/vagrant-up.sh
```

That command runs `vagrant up --provider=utm` (first boot downloads the box and provisions passwordless sudo) then `vagrant ssh` into `./console` on the guest. Source is VirtFS-mounted from your Mac into the guest home (`~/dev`, `~/turbopaneld`, `~/turbopanel`, `~/ui`, `~/website` — the same paths `dev.turbopanel.sh` would use); FHS paths (`/etc/turbopanel`, `/opt/turbopanel`, …) stay on the VM disk — that tree only ever holds vendored runtimes, the production binary, and the built static UI, never source. After converge, open `https://localhost:8443` on the **Mac** (ports `8443` / `8880` are forwarded).

UTM may prompt to allow host folder access for shared directories. First `vagrant up` can take several minutes. After package upgrades, if a newer kernel is pending the guest **reboots once** during provision (SSH drops for about a minute — expected; Vagrant waits and continues). The guest pins pnpm's store to `/var/lib/pnpm/store` with `packageImportMethod: copy` via `~/.config/pnpm/config.yaml` (pnpm 11 only reads pnpm-specific settings from that global YAML file or `pnpm-workspace.yaml` — never `.npmrc`) — without it, pnpm's SQLite-backed store defaults onto the VirtFS/9p-mounted project directory, and SQLite's WAL mode fails there with `[ERR_SQLITE_ERROR] disk I/O error`. The provisioner bind-mounts each mounted repo's `node_modules` (`dev`, `turbopanel`, `ui`, `website`) from a guest-local `ext4` directory under `/var/lib/turbopanel-dev/node_modules/<repo>/node_modules` — ARM64 hosts don't invalidate the instruction cache for pages faulted in from FUSE-backed filesystems (9p/virtiofs), so native Node addons like esbuild/Rolldown/lightningcss crash with `SIGSEGV`/`SIGILL` when `node_modules` lives directly on the VirtFS mount. A symlink is not enough: Next.js Turbopack rejects `node_modules` that points outside the project, and Node ESM realpath walks still need a directory named `node_modules` (`drizzle-kit` otherwise reports "Please install latest version of drizzle-orm"). Source stays VirtFS-mounted for editing from the Mac; only `node_modules` moves. If `df -h /` shows a very small root disk, expand it in UTM (drive → Resize) then grow the guest filesystem — an 8 GiB swapfile is only created when enough free space remains. `pnpm install` into the shared tree can still be slower than bare metal (copy import).

### Bare Debian host

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
| Sibling repos | `~/turbopaneld`, `~/turbopanel`, `~/ui`, `~/website` cloned or updated |
| FHS mutable data | `/etc/turbopanel`, `/var/lib/turbopanel`, `/var/log/turbopanel`, `/run/turbopanel` (dev-user-owned) |
| Vendored runtimes | `/opt/turbopanel/vendor/{node,deno,caddy,…}` |
| systemd units | `turbopaneld`, `turbopanel-instance`, `turbopanel-caddy`, `turbopanel-ui`, Docker-backed services |
| Local URL | `https://localhost:8443` (TLS) and `http://localhost:8880` (plaintext dev) |

No dedicated `tp` / `tpctrl` service accounts are created in dev — everything runs as your user.

## Repositories fetched

| Checkout | Repository |
| --- | --- |
| `~/dev` | [turbopanel/dev](https://github.com/turbopanel/dev) (this repo — bootstrap only) |
| `~/turbopaneld` | [turbopanel/turbopaneld](https://github.com/turbopanel/turbopaneld) |
| `~/turbopanel` | [turbopanel/turbopanel](https://github.com/turbopanel/turbopanel) |
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

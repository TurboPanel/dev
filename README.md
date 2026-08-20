# TurboPanel Development Environment

> **Contributor tooling only — this is not the production or self-hosted install path.**
> To run TurboPanel in production or self-host the control plane, see
> **[Self-hosted overview](https://turbopanel.io/docs/deployment/self-hosted)** and
> **[Control plane deployment](https://turbopanel.io/docs/deployment/control-plane)**.

GitHub: [turbopanel/dev](https://github.com/turbopanel/dev)

## How contributor development works

TurboPanel is **not a monorepo**. You clone (or fork) six sibling repositories
under one parent directory, then run the stack inside a **Vagrant** guest. The
guest mounts those checkouts so you edit on the host (VS Code / Cursor / etc.)
while Node, Deno, Docker, and systemd live in the VM.

## Repository layout

Clone all six repos as siblings (any parent path works — example below). Use
your own forks and feature branches so you can open PRs against `trunk`:

```
turbopanel/
├── dev/          # this repo — Vagrantfile + Ink console
├── turbopaneld/  # host daemon + Ansible
├── turbopanel/   # control plane (Hono / Workers + Deno)
├── ui/           # Expo product console
├── website/      # marketing + docs
└── .github/      # community health files
```

| Checkout | Repository |
| --- | --- |
| `dev/` | [turbopanel/dev](https://github.com/turbopanel/dev) |
| `turbopaneld/` | [turbopanel/turbopaneld](https://github.com/turbopanel/turbopaneld) |
| `turbopanel/` | [turbopanel/turbopanel](https://github.com/turbopanel/turbopanel) |
| `ui/` | [turbopanel/ui](https://github.com/turbopanel/ui) |
| `website/` | [turbopanel/website](https://github.com/turbopanel/website) |
| `.github/` | [turbopanel/.github](https://github.com/turbopanel/.github) |

Inside the guest these mount at `~/dev`, `~/turbopaneld`, `~/turbopanel`,
`~/ui`, `~/website`, and `~/.github`. FHS trees (`/etc/turbopanel`,
`/opt/turbopanel`, …) stay on the VM disk.

## System requirements

We recommend **at least an Intel Core i7-4790K (or equivalent) with 16 GB of
RAM**. Some workloads need more memory, so **24 GB+ is recommended**, and
**32 GB is ideal**.

| Requirement | Recommendation |
| --- | --- |
| **CPU** | Intel Core i7-4790K or equivalent |
| **RAM** | **16 GB** minimum · **24 GB+** recommended · **32 GB** ideal |
| **Software** | [Vagrant](https://developer.hashicorp.com/vagrant) plus a provider (see below) |
| **OS** | macOS or Linux (Windows / WSL is not officially supported) |

The guest is allocated 8 GB; remaining RAM is for the host OS, IDE, and
tooling. A host with less than 16 GB of RAM will struggle to run the VM and
local tooling at the same time.

## Host prerequisites

| Host OS | Provider | Guest box |
| --- | --- | --- |
| **Linux** | [Vagrant](https://developer.hashicorp.com/vagrant) + QEMU/KVM + [libvirt](https://libvirt.org/) + [`vagrant-libvirt`](https://vagrant-libvirt.github.io/vagrant-libvirt/) | Debian 13 (`debian/trixie64`) |
| **macOS** | Vagrant + [UTM](https://mac.getutm.app/) + [`vagrant_utm`](https://github.com/naveenrajm7/vagrant_utm) | Debian 12 (`utm/bookworm`) until a Trixie UTM box exists |

That table is the currently documented pair — not a closed list. macOS and
Linux will likely take several more providers over time. Pull requests that
add a working provider (`Vagrantfile` + docs) are welcome.

You also need Git + a GitHub SSH key on the **host** (agent-forwarded into the
guest). You do **not** need Node, Deno, or Docker on the host — the guest
installs those via `./console` / converge.

### Linux (libvirt)

Install Vagrant, QEMU/KVM, libvirt, dnsmasq, VirtioFS support, and the
`vagrant-libvirt` plugin. Add your user to the `libvirt` group and ensure
libvirt’s default network and storage pool are active.

### macOS (UTM)

```sh
brew install --cask utm
brew install hashicorp/tap/hashicorp-vagrant
vagrant plugin install vagrant_utm
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
```

## Boot the environment

From the **`dev`** checkout (where the `Vagrantfile` lives):

```sh
cd path/to/turbopanel/dev
vagrant up
vagrant ssh
```

Plain `vagrant up` auto-selects **libvirt** on Linux and **UTM** on macOS
(`VAGRANT_DEFAULT_PROVIDER` still overrides). First boot downloads the box,
upgrades packages, and may reboot the guest once when a newer kernel is pending
(SSH drops for about a minute — expected).

Inside the guest (SSH lands in `$HOME`):

```sh
dev/console
```

That ensures pinned Node, runs `pnpm install`, and launches the Ink developer
console. On a fresh guest the console bootstraps the daemon and converges the
stack (optional-services picker after bootstrap). On later launches it sits idle
until you use Developer → **Converge / re-converge**.

## Ports forwarded to the host

After `vagrant up`, these guest ports are available on the host. Use them from
the IDE, browsers, or remote test machines.

| Port | Service | Host bind |
| --- | --- | --- |
| **8443** | Control plane (Caddy HTTPS) | `0.0.0.0` (LAN) |
| **8880** | Control plane (Caddy plaintext HTTP, dev overlay) | `0.0.0.0` (LAN) |
| **8081** | Expo / Metro (native + direct; Caddy also proxies this) | `0.0.0.0` (LAN) |
| **8088** | Optional extra forward (guest must listen) | `0.0.0.0` (LAN) |
| **19820** | Website (Next.js) | `0.0.0.0` (LAN) |
| **4983** | Drizzle Studio (unauthenticated) | `127.0.0.1` only |
| **8025** | Mailpit web UI (unauthenticated) | `127.0.0.1` only |
| **5540** | Redis Insight (unauthenticated) | `127.0.0.1` only |
| **8125** | Tabix (unauthenticated) | `127.0.0.1` only |

- **Local browsing / VS Code / Cursor:** `https://localhost:8443` or
  `http://localhost:8880`.
- **Remote test machines / extra daemons:** prefer a hostname for your
  development host (for example `https://dev.lan:8443` or your LAN IP) so
  clients are not stuck on `localhost`. Ports `8443` / `8880` / `8081` /
  `8088` / `19820` listen on all host interfaces. Trust the platform CA
  (`/var/lib/turbopanel/tls/ca-bundle.pem` after converge, or
  `GET /api/daemon/v1/instance/ca`) when using HTTPS.
- **Studio / Mailpit / Redis Insight / Tabix** stay loopback-only on purpose —
  those UIs are unauthenticated.

Smoke test from the host:

```sh
curl -k https://localhost:8443/api/health
curl http://localhost:8880/api/health
```

## What converge changes (inside the guest)

| Area | Paths / effect |
| --- | --- |
| FHS mutable data | `/etc/turbopanel`, `/var/lib/turbopanel`, `/var/log/turbopanel`, `/run/turbopanel` (dev-user-owned) |
| Vendored runtimes | `/opt/turbopanel/vendor/{node,deno,caddy,…}` |
| systemd units | `turbopaneld`, `turbopanel-instance`, `turbopanel-caddy`, `turbopanel-ui`, Docker-backed services |
| Local URL | `https://localhost:8443` (TLS) and `http://localhost:8880` (plaintext) |

No dedicated `tp` / `tpctrl` service accounts are created in dev — everything
runs as the guest user.

## Further reading

- [Local development guide](https://turbopanel.io/docs/getting-started/development?utm_source=github-dev-readme)
- [Prerequisites](https://turbopanel.io/docs/development/prerequisites)
- [Architecture](https://turbopanel.io/docs/architecture)
- [Troubleshooting](https://turbopanel.io/docs/getting-started/tilt-troubleshooting)
- [Cleanup / uninstall](https://turbopanel.io/docs/deployment/uninstall#contributor-dev-environment)

## Contributing

See [CONTRIBUTING.md](https://github.com/turbopanel/.github/blob/trunk/CONTRIBUTING.md). Default branch: **`trunk`**. Feature branch + PR only. Pull requests are accepted under the [Contributor License Agreement](https://github.com/turbopanel/.github/blob/trunk/CLA.md).

Agent conventions: [AGENTS.md](./AGENTS.md).

## License

TurboPanel Development Environment is licensed under the [GNU Affero General Public License v3.0 only (AGPL-3.0-only)](./LICENSE).

The TurboPanel name and logos are trademarks. See [TRADEMARKS.md](./TRADEMARKS.md).

Copyright (C) 2025-2026 TurboPanel contributors

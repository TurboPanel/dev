# Dev Environment Runbook

Maintainer reference moved out of the root `AGENTS.md`.

## Vagrant Guest

**Vagrant:** root [`Vagrantfile`](./Vagrantfile). Plain `vagrant up`
auto-selects **libvirt** on Linux (`vagrant-libvirt`, Debian 13
`debian/trixie64`) and **UTM** on macOS (`vagrant_utm`, Debian 12
`utm/bookworm`); `VAGRANT_DEFAULT_PROVIDER` still permits an explicit
override. Linux shares use bidirectional VirtioFS with explicit **memfd**
shared-memory backing; do not leave only `access mode=shared`, because libvirt
then file-backs all guest RAM under `/var/lib/libvirt/qemu/ram` and guest
memory churn causes severe host disk writeback/I/O pressure.
UTM uses VirtFS. Synced folders map host siblings
`../{turbopaneld,turbopanel,ui,website}` and this repo (`.`) to guest
`$HOME/{dev,turbopaneld,turbopanel,ui,website}` so default
`TURBOPANEL_DEV_ROOT=$HOME` matches bare metal — confirmed against the daemon's
Ansible roles (`daemon-launch`, `instance-launch`, etc.): source always
resolves to `<dev_root>/<repo>` when `turbopanel_dev_user` is set, and
`/opt/turbopanel` in dev holds **only** vendored runtimes, the production
binary, and the built static UI — never source checkouts. `../.github`
(community health files) mounts to `$HOME/.github` when present on the host;
otherwise the `github-repo` Ansible role clones it inside the guest via HTTPS.
FHS trees stay **guest-local**. Ports `80` / `443` (hosting Caddy) / `8443` / `8081` / `8088` / `19820` forward
to the host on `0.0.0.0` (LAN-reachable, not localhost-only). Drizzle Studio
`4983`, Mailpit `8025`, Redis Insight `5540`, and the DuckDB UI `4213` are loopback-only
on both sides of the forward (`127.0.0.1` host and guest): those APIs are
unauthenticated. The hosted HTTPS Studio UI must use `?host=localhost` rather
than a private hostname such as `studio.lan`. All forwards target **guest
loopback** so they still work when the libvirt DHCP address changes. The
`dev-forward-hosts` provisioner (`run: always`) writes the host's LAN
addresses, `Socket.gethostname` when it is a dotted FQDN, and any extra
LAN aliases to `/etc/turbopanel/dev-forward-hosts` so the Platform CA leaf
covers the name Add Server dials through the 8443 forward. Aliases are
not discovered from a NIC: set `TURBOPANEL_DEV_LAN_ALIASES` (comma or
whitespace separated) or list one name per line in gitignored
`local/lan-aliases` (see `local/lan-aliases.example`). Re-provision that
step, then converge, before dialing the alias. A name that is still not a
SAN is refused when the install command is minted.

## Filesystem layout

```
~/dev/                    # turbopanel/dev checkout (Vagrant mounts host sibling here)
├── Vagrantfile           # libvirt/UTM guest: mounts + port forwards + light provision
├── console               # ensure Node, pnpm install, launch the TUI via vite-node
├── orchestration/        # Ansible dev overlay + development Caddyfile
│   ├── Caddyfile         # co-located control-plane proxy (Expo, :8443, wrangler)
│   └── expo-loading.html # Expo cold-start page served by the development Caddyfile
├── package.json          # Node project (pnpm, pinned via packageManager); ink + react + vite
├── src/tui.tsx           # Ink entrypoint
├── scripts/guest/        # Vagrant SSH MOTD (T-mark banner + ~/dev/console)
└── …

~/turbopaneld/                 # $TURBOPANEL_DEV_ROOT/turbopaneld (optional override: TURBOPANEL_DAEMON_REPO)
~/turbopanel/               # $TURBOPANEL_DEV_ROOT/turbopanel (optional override: TURBOPANEL_INSTANCE_REPO)
~/ui/                     # $TURBOPANEL_DEV_ROOT/ui (optional override: TURBOPANEL_UI_REPO)
~/website/                # $TURBOPANEL_DEV_ROOT/website (optional override: TURBOPANEL_WEBSITE_REPO)
~/.github/                # turbopanel_github_dir (github-repo Ansible role; not a TURBOPANEL_*_REPO var)

/opt/turbopanel/vendor/
├── node/current/bin/node   # pinned Node (installed by ./console + node-runtime role)
├── node/current/bin/pnpm   # pnpm shim (Corepack)
├── deno/current/deno       # pinned Deno (deno-runtime role / console bootstrap)
├── caddy/current/caddy     # …
└── …                       # uv/python/ansible (orchestration bootstrap)

/etc/turbopanel/          # config (dev-user-owned): daemon.env, instance/, rabbitmq/, …
/var/lib/turbopanel/      # persistent state (dev-user-owned)
/var/log/turbopanel/      # service logs (dev-user-owned)
/run/turbopanel/          # runtime sockets (dev-user-owned)
/opt/turbopanel/share/ui/ # static UI export (production build mode)
~/.local/console/         # console converge logs (consoleLogDir())
```

Node is a pinned `nodejs.org` tarball vendored under `/opt/turbopanel/vendor/node/<version>/` with a `current` symlink (same layout as deno/caddy). pnpm is provisioned via Corepack and pinned by the `packageManager` field in `package.json`. **Node 25+ no longer ships Corepack**, so `./console` (and the daemon `node-runtime` role) install it with the vendored `npm install -g corepack` into that prefix, then Corepack still activates the hashed pnpm pin. Deno is **host-provided in development** (preferred) or bootstrap-installed to `/opt/turbopanel/vendor/deno/current/deno` when host Deno is absent; the dev console always runs the daemon and orchestration **from the source checkout** via Deno. Production daemon installs use native `/opt/turbopanel/bin/turbopaneld` or, when that binary cannot execute on the host, `turbopaneld.js` via vendored Deno — driven by `run.sh` + Ansible, never by this console.

## Fresh-clone → working dev

1. Clone (or fork) the six sibling repos under one parent directory on the host (`dev`, `turbopaneld`, `turbopanel`, `ui`, `website`, `.github`).
2. From the host `dev` checkout: `vagrant up` then `vagrant ssh`.
3. Inside the guest: `dev/console` → prereqs, pinned Node, `pnpm install`, TUI launch (exports `TURBOPANEL_MODE=development` and `TURBOPANEL_DEV_ROOT`; a `TURBOPANEL_<DIR>_REPO` override is forwarded only when you set one).
4. **Bootstrap / converge** → the console uses `resolveDevEnvStartupPlan` (`src/lib/dev-env-readiness.ts`) on launch: **auto-bootstraps** (daemon install → systemd unit) when prerequisites are missing; after bootstrap finishes it opens the **optional services** picker then converges (`if-needed`). When the host is already installed, launch sits **idle** — no auto-converge (use Developer → **Converge / re-converge**). The converge picker defaults to UI + website + Mailpit + Drizzle Studio on (Redis Insight and the Stripe CLI forwarder off); idle for 5s continues with the current selection. The Stripe CLI service (`turbopanel-stripe-listen`, daemon role `stripe-listen`, Workers runtime only — wrangler reads secrets from `.dev.vars`) forwards sandbox events to `/webhook/stripe`; it needs a test-mode `TURBOPANEL_STRIPE_SECRET_KEY` written by hand into `/etc/turbopanel/stripe-listen/stripe.env` (never generated or committed) and exits with a pointer to that file otherwise. On the Workers runtime, Developer → **Save tier catalogue** writes the billing tiers a superadmin bound to payment-provider products (Admin → Tiers) to the gitignored `local/tiers.json`, and the dev overlay role `dev-tier-catalogue` restores them on converge when the database holds no **priced** tier row (the unpriced `SX` row a deno-mode instance creates for its licence grant does not count, and a label already present is skipped); the instance and daemon repos know nothing of it (see `local/README.md`). Drizzle Studio and Mailpit stay listed on the Services screen in gray when not enabled — select the row and press **E**, or use Developer → **Optional services…**. That menu also starts/stops optional units anytime without a full converge. Daemon bootstrap (`installDaemon` in `src/lib/platform-install.ts`) **uses an existing usable checkout** when `~/turbopaneld` already has `main.ts` or `orchestration/ansible.cfg` (Vagrant VirtFS mounts and pre-cloned siblings — no guest-side clone/pull; Git may also refuse mounted trees via `safe.directory`); it only **clones** when that path is missing. Bootstrap then writes `/etc/turbopanel/daemon.env`, runs the `dev/orchestration` overlay (runtimes into `/opt/turbopanel/vendor`, systemd units + Docker (postgres/redis/rabbitmq/mailpit) as the dev user, mutable data under FHS trees dev-user-owned; no `tp` / `tpctrl` / `tpcache` accounts created).
5. On the **host**, open `https://localhost:8443`; edit source in the host sibling checkouts (mounted into the guest). Prefer a LAN hostname when attaching remote test machines.

## Vagrantfile Responsibilities

- **`Vagrantfile`** — host-aware libvirt/UTM provider config, bidirectional VirtioFS/VirtFS mounts of the five workspace repos plus optional `.github`, SSH agent forwarding, port forwards `80`/`443` (hosting Caddy) / `8443`/`8081`/`8088`/`19820` (LAN `0.0.0.0`) plus loopback-only `4983`/`8025`/`5540`/`4213`, all with `guest_ip: 127.0.0.1`, and idempotent shell
provision split as `system-upgrade` → `turbopanel_reboot_if_needed` → `guest-setup` → `sshd-port-forward-keepalives` (`run: always`) → `guest-motd` (`run: always`) → `turbopanel_ensure_libvirt_port_forwards` (`run: always`). Upgrades run `apt-get update` + `upgrade` + `autoremove` + `curl` and set the `vagrant` login password; when Debian leaves `/var/run/reboot-required` or the running kernel differs from the newest `/boot/vmlinuz-*`, the reboot provisioner prints that SSH will drop for about a minute, reboots via the guest reboot capability (Vagrant waits for SSH), **remounts VirtioFS synced folders** (mid-provision reboot otherwise leaves empty `~/dev` mount-point dirs — Vagrant only mounts shares on `up`/`reload`), then `guest-setup` finishes (passwordless sudo, `/etc/profile.d/turbopanel-vagrant.sh`, pnpm's `~/.config/pnpm/config.yaml` pointing `storeDir` at guest-local `/var/lib/pnpm/store`, per-repo `node_modules` **bind mounts** from `/var/lib/turbopanel-dev/node_modules/<repo>/node_modules` (systemd `turbopanel-virtfs-node-modules.service` at boot), 8 GiB `/swapfile`). **Libvirt port forwards are SSH `-L` tunnels** (not QEMU `hostfwd`); guest reboot / sshd restart / OpenSSH 9.8+ `UnusedConnectionTimeout` drop idle one-shot vagrant-libvirt `ssh -N` sessions. `sshd-port-forward-keepalives` writes `/etc/ssh/sshd_config.d/turbopanel-vagrant.conf` (`UnusedConnectionTimeout 0` when the guest sshd supports it; `PrintMotd no` so PAM owns the banner). `guest-motd` replaces Debian's default login MOTD with the official T-mark banner from `scripts/guest/motd.sh` (`/etc/motd.d/10-turbopanel`, empty `/etc/motd`, stock `update-motd.d` fragments chmod `-x`) — safe while `./console` is up. `turbopanel_ensure_libvirt_port_forwards` then replaces those one-shot tunnels with a restarting `ssh_forward_supervisor.sh` per port (health = host TCP listen plus our supervisor pid, not leftover libvirt ssh; host **80**/**443** wrap the supervisor in `sudo -n` when `net.ipv4.ip_unprivileged_port_start` still blocks the bind). Heal without a full reload: `vagrant provision --provision-with sshd-port-forward-keepalives,guest-motd,turbopanel_ensure_libvirt_port_forwards` (do not run a full `vagrant provision` while `./console` is up — that re-runs guest-setup). Linux defaults to libvirt + `debian/trixie64`; macOS defaults to UTM + `utm/bookworm`. Does not clone platform repos or run `./console`. Why bind-mount `node_modules`: on ARM64, FUSE-backed filesystems (9p/virtiofs, which is how UTM VirtFS is implemented) don't invalidate the instruction cache for pages faulted in from mmap'd executable files, so native Node addons (esbuild, `@rolldown/binding-*`, lightningcss, ...) crash with `SIGSEGV`/`SIGILL` when `node_modules` lives directly on the VirtFS mount — the pnpm store already being local isn't enough, since `packageImportMethod: copy` still writes the actual files into `node_modules` on the mount. A **symlink** is not enough: Next.js Turbopack rejects `node_modules` that points outside the project (`Symlink [project]/node_modules is invalid, it points out of the filesystem root`), and Node ESM/CJS realpath walks miss packages unless the physical path ends in a directory named `node_modules` (flat `<repo>/drizzle-orm` makes `drizzle-kit` fail with "Please install latest version of drizzle-orm"; Tamagui fails with `Cannot find module 'typescript'`). The provisioner runs for every mounted repo with a `package.json` (`dev`, `turbopanel`, `ui`, `website`; `turbopaneld` has none) and is idempotent across `vagrant provision` re-runs. On boot, its helper waits for all four Vagrant shares to expose `package.json` before binding—the shares are mounted over SSH after userspace starts, so an immediate check can otherwise exit successfully without mounting anything—and dbstudio/UI/website/instance units are ordered after it. Ansible `instance-repo` / `ui-repo` / `website-repo` must probe a nested package (`drizzle-kit`, `expo`, `next`) before skipping `pnpm install` — the mount point exists while the guest tree is still empty. A provisioner layout change wipes a flat tree; the next `pnpm install` (console for `dev`, converge for the others) refills it from the guest pnpm store. Do not `vagrant provision` while `./console` is running if that would rebuild the `dev` tree.

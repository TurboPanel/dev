# Dev Environment Runbook

Maintainer reference moved out of the root `AGENTS.md`.

## Vagrant Guest

**Vagrant:** root [`Vagrantfile`](../Vagrantfile). Plain `vagrant up`
auto-selects **libvirt** on Linux (`vagrant-libvirt`, Debian 13
`debian/trixie64`) and **UTM** on macOS (`vagrant_utm`, Debian 12
`utm/bookworm`); `VAGRANT_DEFAULT_PROVIDER` still permits an explicit
override. Linux shares use bidirectional VirtioFS with explicit **memfd**
shared-memory backing; do not leave only `access mode=shared`, because libvirt
then file-backs all guest RAM under `/var/lib/libvirt/qemu/ram` and guest
memory churn causes severe host disk writeback/I/O pressure.
UTM uses VirtFS. Synced folders map host siblings
`../{turbopaneld,turbopanel,ui,website}` and this repo (`.`) to guest
`$HOME/{dev,turbopaneld,turbopanel,ui,website}` so the default
`TURBOPANEL_DEV_ROOT=$HOME` applies unchanged in the guest. The daemon's
Ansible roles (`daemon-launch`, `instance-launch`, etc.) resolve source to
`<dev_root>/<repo>` when `turbopanel_dev_user` is set (a host-native checkout
can move the root, see Repos Outside the Home Folder below), and
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

## Filesystem Layout

The repos sit in `$TURBOPANEL_DEV_ROOT/<repo>`. On a direct machine that is a folder named `turbopanel` (see Repos Outside the Home Folder):

```
~/turbopanel/             # $TURBOPANEL_DEV_ROOT (direct mode; any folder named turbopanel)
├── .turbopanel-dev-mode  # written by dev/scripts/setup.sh; ./console reads dev_root from it
├── dev/                  # turbopanel/dev checkout (./console, Vagrantfile, orchestration/)
├── turbopaneld/          # optional override: TURBOPANEL_DAEMON_REPO
├── turbopanel/           # control plane; optional override: TURBOPANEL_INSTANCE_REPO
├── ui/                   # optional override: TURBOPANEL_UI_REPO
├── website/              # optional override: TURBOPANEL_WEBSITE_REPO
└── .github/              # turbopanel_github_dir (github-repo Ansible role)
```

Inside the Vagrant guest the host repos are mounted at `$HOME/<repo>` instead, and `TURBOPANEL_DEV_ROOT` is `$HOME`:

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

/etc/turbopanel/          # config (dev-user-owned after the first converge; root-owned before, on a Direct VM): daemon.env, instance/, rabbitmq/, …
/var/lib/turbopanel/      # persistent state (dev-user-owned)
/var/log/turbopanel/      # service logs (dev-user-owned)
/run/turbopanel/          # runtime sockets (dev-user-owned)
/opt/turbopanel/share/ui/ # static UI export (production build mode)
~/.local/console/         # console converge logs (consoleLogDir())
```

### Repos Outside the Home Folder

Outside the Vagrant guest the repos always sit together in a folder named `turbopanel`, never directly in the home folder: by default `~/turbopanel/{dev,turbopaneld,turbopanel,ui,website,.github}`, or anywhere else as long as the folder is named `turbopanel` (for example `~/work/turbopanel/<repo>`). Only the Vagrant guest uses `$HOME/<repo>`, because the Vagrantfile mounts the host repos there; the guest is recognised by `/etc/profile.d/turbopanel-vagrant.sh`, which its provisioner writes. Run `dev/scripts/setup.sh` (add `--dir <folder>` for another `turbopanel` folder). It writes `dev_root` into `<folder>/.turbopanel-dev-mode`, and `./console` reads that file (parsed, never sourced) when `TURBOPANEL_DEV_ROOT` is unset; an explicit `TURBOPANEL_DEV_ROOT` always wins. Without a mode file, a dev checkout inside a folder named `turbopanel` sets the folder, and otherwise the default is `~/turbopanel`. If the file names a different folder than the one it sits in (the folder was moved), the folder that holds it wins, with a warning.

- One value moves everything. `./console` exports it, the console writes it to `/etc/turbopanel/daemon.env`, and the daemon passes it to every playbook as `turbopanel_dev_root`, so the daemon, control plane, UI and website units, the development Caddyfile and the repo clones all resolve `<root>/<repo>`.
- git, ssh and pnpm still run with `HOME` set to the developer's real home (`TURBOPANEL_DEV_HOME` in `daemon.env`, `turbopanel_dev_home` in Ansible), so SSH keys, `known_hosts`, git config and the pnpm store are found where they always were.
- `./console` and the dev playbook check the value: it must be an absolute path made only of letters, digits and `. _ @ + - /`, with no `.` or `..` parts, and it must be a folder named `turbopanel` outside the Vagrant guest, and a folder the developer can read, or one they can create (the playbook creates a missing one as the developer). A wrong name is refused with a pointer to `dev/scripts/setup.sh`; `setup.sh` itself refuses another name in direct mode, and `vm-bootstrap.sh` refuses it before changing anything. The console also refuses unsafe characters when it writes `daemon.env`. Spaces and shell or YAML characters are refused because the value is written unquoted into systemd `Environment=` lines, `KEY=VALUE` env files, a YAML vars file, Caddyfile placeholders and Ansible `-e key=value` pairs, and any of them would break or split it.
- The per-repo `TURBOPANEL_<DIR>_REPO` overrides still work and still win for a single repo.
- Proof so far: the dev playbook's root and home pre_tasks and the daemon role defaults, run in a throwaway Debian 13 container, resolve every repo under the folder and keep `HOME` on the real home. A full converge from a folder outside the home has not been run yet.

#### Moving an Existing Home-Folder Layout

Older direct setups kept the repos directly in the home folder (`~/dev`, `~/turbopaneld`, `~/turbopanel`, ...). Outside the Vagrant guest, `./console` and `vm-bootstrap.sh` now stop on that layout and print these steps instead of defaulting to an empty `~/turbopanel`. In that layout `~/turbopanel` is the control plane checkout itself, so gather the repos in a new folder first and rename it last. Stop the console, then run `cd ~ && mkdir tp-move && for r in dev turbopaneld turbopanel ui website .github; do [ ! -e "$r" ] || mv "$r" tp-move/; done && mv tp-move turbopanel` (repos you do not have are skipped). Finally run `~/turbopanel/dev/scripts/setup.sh`, which writes the mode file. Move first: `setup.sh` does not move an existing layout, and it refuses to use a folder that is itself a git checkout (in the old layout `~/turbopanel` is the control plane checkout), so it never clones into it.

Node is a pinned `nodejs.org` tarball vendored under `/opt/turbopanel/vendor/node/<version>/` with a `current` symlink (same layout as deno/caddy). pnpm is provisioned via Corepack and pinned by the `packageManager` field in `package.json`. **Node 25+ no longer ships Corepack**, so `./console` (and the daemon `node-runtime` role) install it with the vendored `npm install -g corepack` into that prefix, then Corepack still activates the hashed pnpm pin. Deno is **host-provided in development** (preferred) or bootstrap-installed to `/opt/turbopanel/vendor/deno/current/deno` when host Deno is absent; the dev console always runs the daemon and orchestration **from the source checkout** via Deno. Production daemon installs use native `/opt/turbopanel/bin/turbopaneld` or, when that binary cannot execute on the host, `turbopaneld.js` via vendored Deno — driven by `run.sh` + Ansible, never by this console.

## Contribute

Maintainers and outside contributors use the same steps. On a new machine you do not need to clone anything first: from any folder (your home folder is fine), run the starter script as your normal user, not root. It needs only `git` and `curl` (or `wget`); on a fresh Debian install get them with `sudo apt-get install git curl`, or `su -c 'apt-get install -y git curl sudo'` where sudo is not set up yet.

```bash
curl -fsSL https://raw.githubusercontent.com/TurboPanel/dev/trunk/scripts/start.sh | sh
```

Reading a script before you run it is wise, and the starter is short. The same file also works as download, read, then run:

```bash
curl -fsSL -o start.sh https://raw.githubusercontent.com/TurboPanel/dev/trunk/scripts/start.sh
less start.sh                    # read it
sh start.sh                      # or: sh start.sh --dry-run to see the plan only
```

`scripts/start.sh` installs nothing and uses no sudo. It clones `https://github.com/TurboPanel/dev.git` over HTTPS into `~/turbopanel/dev` (or `<folder>/dev` with `--dir <folder>`, which must be an absolute path to a folder named `turbopanel`), or reuses that checkout when it is already there, then hands over to `dev/scripts/setup.sh` below. Every other option goes to `setup.sh` unchanged; when you pipe the script, put them after `sh -s --`, for example `curl -fsSL https://raw.githubusercontent.com/TurboPanel/dev/trunk/scripts/start.sh | sh -s -- --mode direct`. Even when piped, `setup.sh` asks its questions on your terminal, including whether you use Vagrant (the repos stay in `~/turbopanel` on this machine, and `vagrant up` in `~/turbopanel/dev` runs them in a Debian VM) or Direct (this Debian 13 machine becomes the dev machine, and setup gives your user passwordless sudo). The folder is the same either way. `--dry-run` without a dev checkout prints the plan and clones nothing, because the setup dry run needs the files it would clone. The raw URL always serves the current `trunk`; a pinned release tag with a published checksum is planned hardening.

With the dev repo already cloned, run `setup.sh` directly. You need `git`, and the GitHub CLI `gh` logged in (`gh auth login`) to open pull requests. When `gh` is missing on Debian or Ubuntu, the script asks, then installs it from the official GitHub CLI apt source (it checks the signing key fingerprints first); on macOS run `brew install gh`, elsewhere see https://cli.github.com. When you are not logged in, it offers to run `gh auth login`, where you sign in yourself. `--yes` installs `gh` without asking but never starts the login.

```bash
mkdir turbopanel && cd turbopanel
git clone https://github.com/TurboPanel/dev.git
less dev/scripts/setup.sh        # read it before you run it
./dev/scripts/setup.sh           # prints the plan, asks, then sets everything up
```

- **Where the repos go.** All six repos (`dev`, `turbopanel`, `turbopaneld`, `ui`, `website`, `.github`) sit side by side in a folder named `turbopanel`, wherever you put it (for example `~/turbopanel/<repo>`). Pass `--dir PATH` to choose another folder; in direct mode it must also be named `turbopanel`.
- **What you can do.** At the end of `setup` and `status` the script prints one plain sentence about it: you push to TurboPanel directly (maintainer), you work from your own fork (contributor), or the repos are read-only because you are not signed in; repos that differ, such as `.github`, are listed after it.
- **Push access decides the layout.** With push access to a repo, `origin` is the TurboPanel repo and you push feature branches there. Without it, the script forks the repo to your account, clones your fork as `origin`, adds the TurboPanel repo as `upstream` and runs `gh repo set-default TurboPanel/<repo>` in the checkout so `gh pr create` opens pull requests into TurboPanel without asking. Pass `--fork` to work from forks even with push access. Not logged in, you get read-only clones; run `gh auth login` and rerun the script to add your forks. The `.github` repo is never forked for you, because a fork of it becomes your account's own community health repo; fork it by hand only to change it.
- **Clone method.** HTTPS through `gh` (`gh auth setup-git`), or SSH when `gh config get git_protocol` is `ssh` or a `url.<ssh>.insteadOf https://github.com/` rule is set.
- **Vagrant or direct.** The script asks which to use. Direct mode is offered only on Debian 13 outside a container (see "Direct VM" below); macOS and other hosts get Vagrant only. In Vagrant mode you edit, commit and push on the host; the guest only runs the stack, and the host pre-commit hooks run the secret scan. Non-interactive: `--yes --mode vagrant` or `--yes --mode direct`. `--dry-run` prints the plan and stops.
- **Mode file.** The answer and each repo's role are written to `turbopanel/.turbopanel-dev-mode` (shell-sourceable `key='value'` lines, `TURBOPANEL_DEV_ENV=direct|vagrant`). `ci-verify.sh` reads it.
- **Direct mode folder.** The script passes `TURBOPANEL_DEV_ROOT=<folder>` to `vm-bootstrap.sh` (which clones there with `--clone` and exports it for your login shell) and writes `dev_root` into the mode file, which `./console` reads when `TURBOPANEL_DEV_ROOT` is unset. Then run `<folder>/dev/console`. See Repos Outside the Home Folder below.
- **Safe to rerun.** A rerun fetches every repo, fast-forwards `trunk` only when it is checked out and clean, and never resets, stashes or switches your work.
- **Checks.** `./dev/scripts/setup.sh doctor` reports host facts, tool versions, login, remotes, hooks path, signing settings and whether the mode file fits this machine, and changes nothing. `./dev/scripts/setup.sh status` prints one row per repo (role, branch, ahead/behind trunk, uncommitted files, open pull request) and warns when the same branch name exists in several repos. For a change that spans the control plane and the daemon, link the two pull requests to each other and merge the control plane (`turbopanel`) one before the daemon (`turbopaneld`) one.

## Fresh-Clone → Working Dev

1. Run the starter one-liner, or `./dev/scripts/setup.sh` in an existing clone (see "Contribute"). It puts the six sibling repos under one parent directory on the host (`dev`, `turbopaneld`, `turbopanel`, `ui`, `website`, `.github`). `.github` is optional for `vagrant-up.sh` and the `Vagrantfile`: when it is missing, the `github-repo` Ansible role clones it inside the guest.
2. From the host `dev` checkout: `vagrant up` then `vagrant ssh` (on macOS `./scripts/vagrant-up.sh` does both).
3. Inside the guest: `dev/console` → prereqs, pinned Node, `pnpm install`, TUI launch (exports `TURBOPANEL_MODE=development` and `TURBOPANEL_DEV_ROOT`; a `TURBOPANEL_<DIR>_REPO` override is forwarded only when you set one).
4. **Bootstrap / converge** → on launch the console uses `resolveDevEnvStartupPlan` (`src/lib/dev-env-readiness.ts`): it **auto-bootstraps** (daemon install → systemd unit) when prerequisites are missing; after bootstrap finishes it opens the **optional services** picker, then converges (`if-needed`). When the host is already installed, launch sits **idle** with no auto-converge; use Developer → **Converge / re-converge development environment**. The picker defaults to UI, website, Mailpit and Drizzle Studio on, and Redis Insight and the Stripe CLI forwarder off; idle for 5 seconds continues with the current selection. Drizzle Studio and Mailpit stay listed on the Services screen in gray when not enabled: select the row and press **E**, or use Developer → **Optional services…**, which also starts and stops optional units at any time without a full converge. The daemon checkout, Stripe forwarder and tier catalogue are described under "Daemon Checkout, Stripe Forwarder and Tier Catalogue" below; the console internals are in [`src/AGENTS.md`](../src/AGENTS.md).
5. On the **host**, open `https://localhost:8443`; edit source in the host sibling checkouts (mounted into the guest). Prefer a LAN hostname when attaching remote test machines.

## Direct VM (Proxmox or Bare Metal)

Vagrant stays fully supported. This path is for a plain Debian 13 machine you already run, such as a Proxmox VM or a spare computer, where Vagrant is not wanted. The Developer Console, the daemon install and the Ansible dev overlay all work under any user name you pick: they read it from the logged-in user (`tp_resolve_dev_identity()`) and keep the repos under `$HOME` (`TURBOPANEL_DEV_ROOT`). Nothing needs a `vagrant` account.

### Prerequisites

- Debian 13 (Trixie), a full virtual machine or bare metal. LXC containers are not supported (see below).
- 4 or more CPUs, 8 GB or more RAM, 40 GB or more disk.
- A bridged LAN network card, so other machines can reach the VM by name or address.
- A normal (non-root) user account for development. Any name works, but Debian's `adduser` rejects names with a dot by default: avoid dots, or create the account with `useradd -m` or `adduser --allow-bad-names`.
- Passwordless sudo for that user. This is a plain requirement; the bootstrap script sets it up (sudo group plus a `NOPASSWD` rule checked with `visudo -c`) and there is no password-prompt fallback.
- The GitHub CLI `gh` logged in as that user (`gh auth login`) to open pull requests. `setup.sh` offers to install it from the official apt source and to run `gh auth login` for you. It clones over HTTPS through `gh` by default, and over SSH only when your `gh` `git_protocol` or a `url.<ssh>.insteadOf https://github.com/` rule says so; then a GitHub SSH key is needed, either one created on the VM or your own through `ssh -A`. Without a login you still get read-only HTTPS clones.

### Steps

`./dev/scripts/setup.sh --mode direct` (see "Contribute") does steps 2 to 3 for you: it clones the repos and then runs `vm-bootstrap.sh` through sudo. The manual steps below stay for a machine where you want to run the bootstrap on its own.

1. Install Debian 13 and create your user. Log in as that user. If you use cloud-init, [`scripts/vm-bootstrap.cloud-init.yaml`](../scripts/vm-bootstrap.cloud-init.yaml) is an example that runs the setup script (step 3) on first boot. It does not clone the repos; run `setup.sh` as your user afterwards.
2. Get the script. A fresh install may lack `git` and `curl`, so first run `su -c 'apt-get install -y git curl ca-certificates'` (or `sudo apt-get install -y git curl ca-certificates`). Then `git clone https://github.com/TurboPanel/dev.git ~/turbopanel/dev` (no key or login needed; the script is then `~/turbopanel/dev/scripts/vm-bootstrap.sh`), or download only the script with `curl -fsSL -o ~/vm-bootstrap.sh https://raw.githubusercontent.com/TurboPanel/dev/trunk/scripts/vm-bootstrap.sh` (the script is then `~/vm-bootstrap.sh`). Below, `SCRIPT` means whichever path you have.
3. Run it as root through sudo: `su -c 'sh SCRIPT <you>'` on a fresh install without sudo (use the full path, not `~`), or `sudo sh SCRIPT`. It installs `sudo`, `curl`, `git` and the base packages, adds you to the `sudo` group, writes a per-user rule `/etc/sudoers.d/turbopanel-dev-nopasswd-uid<N>` (named after your numeric user id, so several users never collide) and `/etc/profile.d/turbopanel-dev.sh` (`TURBOPANEL_MODE=development`, and `TURBOPANEL_DEV_ROOT` for your user), and prints the next steps. Options:
   - `--upgrade` runs an apt upgrade first (reboot afterwards if it says so).
   - `--swap` adds an 8 GiB swap file when the disk has room.
   - `--lan-alias NAME` (repeatable) writes the extra DNS names the VM should answer to into `/etc/turbopanel/dev-forward-hosts`, merged with any names already there. Only names the VM cannot see on its own network interfaces, such as a DNS alias, need this.
   - `--clone` clones `dev`, `turbopaneld`, `turbopanel`, `ui`, `website` and `.github` into `~/turbopanel/<repo>` (or `TURBOPANEL_DEV_ROOT`, which must be a folder named `turbopanel`) over SSH (unlike `setup.sh`, it needs a GitHub SSH key) and skips any path that already exists, with a message. `sudo` normally drops your forwarded SSH agent. Try `sudo --preserve-env=SSH_AUTH_SOCK sh SCRIPT --clone` when you rely on `ssh -A`; if your sudo policy refuses that, run the script without `--clone` and clone the repos yourself as your own user. The first clone asks you to trust the github.com host key; check it yourself.
   - The script is safe to run again.
   - Sudo matches rules by user name. The script removes its own rule files whose user no longer exists or now has a different user id. If you delete a dev user by hand, also delete `/etc/sudoers.d/turbopanel-dev-nopasswd-uid<N>`, or a new account with the same name could inherit passwordless sudo.
4. Log out and back in so the `sudo` group applies, then run `~/turbopanel/dev/console`. The first launch installs the pinned Node and pnpm, then bootstraps the platform as described in "Fresh-Clone → Working Dev".

### Editing Model

The repos live on the VM, not on your laptop. Edit them with an editor that works over SSH, for example VS Code Remote-SSH to the VM, and commit from the VM.

### Attaching Remote Test Machines

Give the VM a stable LAN name (a DNS record or a router reservation) and add it with `--lan-alias` if the VM cannot see that name on its own interfaces. Use that name, not `localhost`, when you add a server to the panel from another machine. The panel is on port 8443 of the VM.

### Running the Test Suites

Run everything on the VM itself, with the vendored runtimes first on the path once `./console` has installed them (`export PATH="/opt/turbopanel/vendor/node/current/bin:/opt/turbopanel/vendor/deno/current:$PATH"`): `pnpm test` in `~/turbopanel/dev` and `~/turbopanel/ui`, `deno task test` in `~/turbopanel/turbopaneld`, `pnpm test:do` in `~/turbopanel/turbopanel`, or `./scripts/ci-verify.sh` for all of them. `ci-verify.sh` only re-runs through Vagrant when the vendored Node is missing, so run `./console` once first.

### Why Not LXC

Docker needs nesting inside a container, and the setup writes a swap file, firewall rules and sysctl settings that a container usually restricts. Use a full VM.

## Vagrantfile Responsibilities

- **`Vagrantfile`** — host-aware libvirt/UTM provider config, bidirectional VirtioFS/VirtFS mounts of the five workspace repos plus optional `.github`, SSH agent forwarding, port forwards `80`/`443` (hosting Caddy) / `8443`/`8081`/`8088`/`19820` (LAN `0.0.0.0`) plus loopback-only `4983`/`8025`/`5540`/`4213`, all with `guest_ip: 127.0.0.1`, and idempotent shell
provision split as `system-upgrade` → `turbopanel_reboot_if_needed` → `guest-setup` → `sshd-port-forward-keepalives` (`run: always`) → `guest-motd` (`run: always`) → `turbopanel_ensure_libvirt_port_forwards` (`run: always`). Upgrades run `apt-get update` + `upgrade` + `autoremove` + `curl` and set the `vagrant` login password; when Debian leaves `/var/run/reboot-required` or the running kernel differs from the newest `/boot/vmlinuz-*`, the reboot provisioner prints that SSH will drop for about a minute, reboots via the guest reboot capability (Vagrant waits for SSH), **remounts VirtioFS synced folders** (mid-provision reboot otherwise leaves empty `~/dev` mount-point dirs — Vagrant only mounts shares on `up`/`reload`), then `guest-setup` finishes (passwordless sudo, `/etc/profile.d/turbopanel-vagrant.sh`, pnpm's `~/.config/pnpm/config.yaml` pointing `storeDir` at guest-local `/var/lib/pnpm/store`, per-repo `node_modules` **bind mounts** from `/var/lib/turbopanel-dev/node_modules/<repo>/node_modules` (systemd `turbopanel-virtfs-node-modules.service` at boot), 8 GiB `/swapfile`). **Libvirt port forwards are SSH `-L` tunnels** (not QEMU `hostfwd`); guest reboot / sshd restart / OpenSSH 9.8+ `UnusedConnectionTimeout` drop idle one-shot vagrant-libvirt `ssh -N` sessions. `sshd-port-forward-keepalives` writes `/etc/ssh/sshd_config.d/turbopanel-vagrant.conf` (`UnusedConnectionTimeout 0` when the guest sshd supports it; `PrintMotd no` so PAM owns the banner). `guest-motd` replaces Debian's default login MOTD with the official T-mark banner from `scripts/guest/motd.sh` (`/etc/motd.d/10-turbopanel`, empty `/etc/motd`, stock `update-motd.d` fragments chmod `-x`) — safe while `./console` is up. `turbopanel_ensure_libvirt_port_forwards` then replaces those one-shot tunnels with a restarting `ssh_forward_supervisor.sh` per port (health = host TCP listen plus our supervisor pid, not leftover libvirt ssh; host **80**/**443** wrap the supervisor in `sudo -n` when `net.ipv4.ip_unprivileged_port_start` still blocks the bind). Heal without a full reload: `vagrant provision --provision-with sshd-port-forward-keepalives,guest-motd,turbopanel_ensure_libvirt_port_forwards` (do not run a full `vagrant provision` while `./console` is up — that re-runs guest-setup). Linux defaults to libvirt + `debian/trixie64`; macOS defaults to UTM + `utm/bookworm`. Does not clone platform repos or run `./console`. Why bind-mount `node_modules`: on ARM64, FUSE-backed filesystems (9p/virtiofs, which is how UTM VirtFS is implemented) don't invalidate the instruction cache for pages faulted in from mmap'd executable files, so native Node addons (esbuild, `@rolldown/binding-*`, lightningcss, ...) crash with `SIGSEGV`/`SIGILL` when `node_modules` lives directly on the VirtFS mount — the pnpm store already being local isn't enough, since `packageImportMethod: copy` still writes the actual files into `node_modules` on the mount. A **symlink** is not enough: Next.js Turbopack rejects `node_modules` that points outside the project (`Symlink [project]/node_modules is invalid, it points out of the filesystem root`), and Node ESM/CJS realpath walks miss packages unless the physical path ends in a directory named `node_modules` (flat `<repo>/drizzle-orm` makes `drizzle-kit` fail with "Please install latest version of drizzle-orm"; Tamagui fails with `Cannot find module 'typescript'`). The provisioner runs for every mounted repo with a `package.json` (`dev`, `turbopanel`, `ui`, `website`; `turbopaneld` has none) and is idempotent across `vagrant provision` re-runs. On boot, its helper waits for all four Vagrant shares to expose `package.json` before binding—the shares are mounted over SSH after userspace starts, so an immediate check can otherwise exit successfully without mounting anything—and dbstudio/UI/website/instance units are ordered after it. Ansible `instance-repo` / `ui-repo` / `website-repo` must probe a nested package (`drizzle-kit`, `expo`, `next`) before skipping `pnpm install` — the mount point exists while the guest tree is still empty. A provisioner layout change wipes a flat tree; the next `pnpm install` (console for `dev`, converge for the others) refills it from the guest pnpm store. Do not `vagrant provision` while `./console` is running if that would rebuild the `dev` tree.

## Daemon Checkout, Stripe Forwarder and Tier Catalogue

- **Daemon checkout:** `installDaemon` (`src/lib/platform-install.ts`) uses an existing `~/turbopaneld` as it is when it holds `main.ts` or `orchestration/ansible.cfg`, which is the case for Vagrant mounts and pre-cloned siblings. It never clones or pulls into a usable tree, and clones over SSH only when the path is missing. A path that exists but holds neither marker is an error.
- **Stripe forwarder:** the daemon role `stripe-listen` installs the `turbopanel-stripe-listen` service, which forwards sandbox events to the instance's `/webhook/stripe`. It applies only to the Workers runtime. The role seeds `/etc/turbopanel/stripe-listen/stripe.env` once with empty values and never overwrites it. Paste a test-mode `TURBOPANEL_STRIPE_SECRET_KEY` into it by hand; nothing generates it and it is never committed. With the key blank the forwarder exits with a pointer to that file. The webhook signing secret in the same file is rewritten by the wrapper on every start.
- **Tier catalogue:** `local/tiers.json` (gitignored; see `local/README.md`) holds the billing tiers a superadmin bound to payment-provider products. `src/lib/save-dev-tier-catalogue.ts` writes it. The dev overlay role `dev-tier-catalogue` restores it on a Workers-runtime converge, only when the database holds no priced tier row. The unpriced `SX` row does not count, a label already present is skipped, and the instance and daemon repos know nothing of it.

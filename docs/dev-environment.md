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
`~/turbopanel/{dev,turbopaneld,turbopanel,ui,website}`, the same folder named
`turbopanel` as on any other dev machine, so the default
`TURBOPANEL_DEV_ROOT=$HOME/turbopanel` applies unchanged in the guest. The
provisioner makes that folder belong to the `vagrant` user (Vagrant creates
missing mount points as root). A guest created before the mounts moved still
has them at `~/<repo>`; `./console`, `setup.sh` and `scripts/vagrant-up.sh`
stop there. Rebuild it with `vagrant destroy -f && vagrant up` on the host (the
guest holds no source). `vagrant reload --provision` is faster but leaves the
daemon unit and `daemon.env` pointing at the old paths, so follow it with
Developer → Reset development environment in the console.
The old `~/<repo>` folders in such a guest are empty mount points; the
checkouts stay on the host. This change is not yet proven on a real guest:
the first `vagrant up` / `vagrant reload --provision` after it confirms the
mounts, the folder ownership and the `node_modules` bind mounts. The daemon's
Ansible roles (`daemon-launch`, `instance-launch`, etc.) resolve source to
`<dev_root>/<repo>` when `turbopanel_dev_user` is set (a host-native checkout
can move the root, see Repos Outside the Home Folder below), and
`/opt/turbopanel` in dev holds **only** vendored runtimes, the production
binary, and the built static UI — never source checkouts. `../.github`
(community health files) mounts to `~/turbopanel/.github` when present on the host;
otherwise the `github-repo` Ansible role clones it inside the guest via HTTPS.
FHS trees stay **guest-local**. Ports `80` / `443` (hosting Caddy) / `8443` / `8081` / `8088` / `19820` forward
to the host on `0.0.0.0` (LAN-reachable, not localhost-only). Drizzle Studio
`4983`, Mailpit `8025`, Redis Insight `5540`, and the DuckDB UI `4213` are loopback-only
on both sides of the forward (`127.0.0.1` host and guest): those APIs are
unauthenticated. The hosted HTTPS Studio UI must use `?host=localhost` rather
than a private hostname such as `dev-workstation.example.lan`. All forwards target **guest
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

The repos sit in `$TURBOPANEL_DEV_ROOT/<repo>`, always a folder named `turbopanel`, on a direct machine and in the Vagrant, Incus and Lima guests alike (see Repos Outside the Home Folder):

```
~/turbopanel/             # $TURBOPANEL_DEV_ROOT (any folder named turbopanel; the guest mounts the host repos here)
├── .turbopanel-dev-mode  # written by dev/scripts/setup.sh on the editing machine (not in the guest); ./console reads dev_root from it
├── dev/                  # turbopanel/dev checkout (./console, Vagrantfile, orchestration/)
├── turbopaneld/          # optional override: TURBOPANEL_DAEMON_REPO
├── turbopanel/           # control plane; optional override: TURBOPANEL_INSTANCE_REPO
├── ui/                   # optional override: TURBOPANEL_UI_REPO
├── website/              # optional override: TURBOPANEL_WEBSITE_REPO
└── .github/              # turbopanel_github_dir (github-repo Ansible role)
```

Inside the Vagrant guest the host repos are mounted at the same `~/turbopanel/<repo>` paths (no mode file there; the default root applies). The `dev` checkout itself:

```
~/turbopanel/dev/         # turbopanel/dev checkout (Vagrant mounts the host checkout here)
├── Vagrantfile           # libvirt/UTM guest: mounts + port forwards + light provision
├── console               # ensure Node, pnpm install, launch the TUI via vite-node
├── orchestration/        # Ansible dev overlay + development Caddyfile
│   ├── Caddyfile         # co-located control-plane proxy (Expo, :8443, wrangler)
│   └── expo-loading.html # Expo cold-start page served by the development Caddyfile
├── package.json          # Node project (pnpm, pinned via packageManager); ink + react + vite
├── src/tui.tsx           # Ink entrypoint
├── scripts/guest/        # Vagrant SSH MOTD (T-mark banner + ~/turbopanel/dev/console)
└── …
```

```
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

The repos always sit together in a folder named `turbopanel`, never directly in the home folder, on every machine including the Vagrant guest: by default `~/turbopanel/{dev,turbopaneld,turbopanel,ui,website,.github}`, or anywhere else as long as the folder is named `turbopanel` (for example `~/work/turbopanel/<repo>`). The guest mounts the host repos at `~/turbopanel/<repo>`. The guest file `/etc/profile.d/turbopanel-vagrant.sh`, which its provisioner writes, now only picks the message for an old guest that still mounts them at `~/<repo>`. Run `dev/scripts/setup.sh` (add `--dir <folder>` for another `turbopanel` folder). It writes `dev_root` into `<folder>/.turbopanel-dev-mode`, and `./console` reads that file (parsed, never sourced) when `TURBOPANEL_DEV_ROOT` is unset; an explicit `TURBOPANEL_DEV_ROOT` always wins. Without a mode file, a dev checkout inside a folder named `turbopanel` sets the folder, and otherwise the default is `~/turbopanel`. If the file names a different folder than the one it sits in (the folder was moved), the folder that holds it wins, with a warning.

- One value moves everything. `./console` exports it, the console writes it to `/etc/turbopanel/daemon.env`, and the daemon passes it to every playbook as `turbopanel_dev_root`, so the daemon, control plane, UI and website units, the development Caddyfile and the repo clones all resolve `<root>/<repo>`.
- git, ssh and pnpm still run with `HOME` set to the developer's real home (`TURBOPANEL_DEV_HOME` in `daemon.env`, `turbopanel_dev_home` in Ansible), so SSH keys, `known_hosts`, git config and the pnpm store are found where they always were.
- `./console` and the dev playbook check the value: it must be an absolute path made only of letters, digits and `. _ @ + - /`, with no `.` or `..` parts, and it must be a folder named `turbopanel` outside the Vagrant guest, and a folder the developer can read, or one they can create (the playbook creates a missing one as the developer). A wrong name is refused with a pointer to `dev/scripts/setup.sh`; `setup.sh` itself refuses another name in direct mode, and `vm-bootstrap.sh` refuses it before changing anything. The console also refuses unsafe characters when it writes `daemon.env`. Spaces and shell or YAML characters are refused because the value is written unquoted into systemd `Environment=` lines, `KEY=VALUE` env files, a YAML vars file, Caddyfile placeholders and Ansible `-e key=value` pairs, and any of them would break or split it.
- The per-repo `TURBOPANEL_<DIR>_REPO` overrides still work and still win for a single repo.
- Proof so far: the dev playbook's root and home pre_tasks and the daemon role defaults, run in a throwaway Debian 13 container, resolve every repo under the folder and keep `HOME` on the real home. A full converge from a folder outside the home has not been run yet.

#### Moving an Existing Home-Folder Layout

Older direct setups kept the repos directly in the home folder (`~/dev`, `~/turbopaneld`, `~/turbopanel`, ...). `./console` and `vm-bootstrap.sh` now stop on that layout and print these steps instead of defaulting to an empty `~/turbopanel`. In that layout `~/turbopanel` is the control plane checkout itself, so gather the repos in a new folder first and rename it last. Stop the console and the daemon (`sudo systemctl stop turbopaneld`), then run `cd ~ && mkdir tp-move && for r in dev turbopaneld turbopanel ui website .github; do [ ! -e "$r" ] || mv "$r" tp-move/; done && mv tp-move turbopanel` (repos you do not have are skipped). Finally run `~/turbopanel/dev/scripts/setup.sh`, which writes the mode file, then `~/turbopanel/dev/console`; its next converge rewrites the daemon and instance units for the new paths. Move first: `setup.sh` does not move an existing layout, and it refuses to use a folder that is itself a git checkout (in the old layout `~/turbopanel` is the control plane checkout), so it never clones into it.

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
- **What you can do.** At the end of `setup` and `status` the script prints one plain sentence about it: you push to TurboPanel directly (maintainer), your repos are read-only clones and `setup.sh fork <repo>` (with the full path) forks one when you are ready to push (contributor), you work from your own fork (after `fork`), or the repos are read-only because you are not signed in; repos that differ, such as `.github`, are listed after it.
- **Push access decides the layout.** With push access to a repo, `origin` is the TurboPanel repo and you push feature branches there. Without it, you get a read-only clone of the TurboPanel repo (`origin` = TurboPanel, no fork yet): forks are made on first push, not up front. When you are ready to push in a repo, run `~/turbopanel/dev/scripts/setup.sh fork <repo>` (several names at once are fine): it forks the repo to your account (or finds your fork, also a renamed one), makes your fork `origin` and the TurboPanel repo `upstream`, sets `trunk` to track `upstream/trunk`, and runs `gh repo set-default TurboPanel/<repo>` so `gh pr create` opens pull requests into TurboPanel without asking. Your branches and commits stay as they are; only the remotes change, and running it again does nothing. Add `--dry-run` to see what it would do first. It needs `gh` and a GitHub login. `status` shows each repo as `maintainer`, `read-only` or `forked`, and `doctor` prints the `fork` command for each read-only clone. `--fork-all` keeps the older behaviour of forking every repo you cannot push to during setup. `--as-contributor` (old name `--fork`) makes a maintainer get the contributor's read-only clones (add `--fork-all` to fork at setup). Not logged in, you get read-only clones; run `gh auth login` and rerun the script. The `.github` repo is never forked for you, because a fork of it becomes your account's own community health repo; `setup.sh fork .github` forks it only when you name it.
- **Clone method.** HTTPS through `gh` (`gh auth setup-git`), or SSH when `gh config get git_protocol` is `ssh` or a `url.<ssh>.insteadOf https://github.com/` rule is set.
- **Vagrant, Incus, Lima or direct.** The script asks which to use. Direct mode is offered only on Debian 13 outside a container (see "Direct VM" below); Incus mode is offered on Linux only (see "Incus VM (Linux)" below); Lima mode is offered on macOS only (see "Lima VM (macOS)" below), which otherwise gets Vagrant. In Vagrant, Incus and Lima mode you edit, commit and push on the host; the guest only runs the stack, and the host pre-commit hooks run the secret scan. Non-interactive: `--yes --mode vagrant`, `--yes --mode incus`, `--yes --mode lima` or `--yes --mode direct`; on macOS `--yes` alone still picks Vagrant. `--dry-run` prints the plan and stops.
- **Mode file.** The answer and each repo's role are written to `turbopanel/.turbopanel-dev-mode` (shell-sourceable `key='value'` lines, `TURBOPANEL_DEV_ENV=direct|vagrant|incus|lima`). `ci-verify.sh` and `game-day.sh` read it.
- **Direct mode folder.** The script passes `TURBOPANEL_DEV_ROOT=<folder>` to `vm-bootstrap.sh` (which clones there with `--clone` and exports it for your login shell) and writes `dev_root` into the mode file, which `./console` reads when `TURBOPANEL_DEV_ROOT` is unset. Then run `<folder>/dev/console`. See Repos Outside the Home Folder below.
- **Safe to rerun.** A rerun fetches every repo, fast-forwards `trunk` only when it is checked out and clean, and never resets, stashes or switches your work.
- **GitHub login.** Setup offers to log you in with `gh auth login --hostname github.com --git-protocol https --web --scopes workflow` (run with gh's prompts turned off): gh prints a one-time code, you enter it at https://github.com/login/device in any browser, and gh finishes on its own. It asks no menu questions, so it works on a headless VM. The `workflow` scope lets you push changes to `.github/workflows/` over https. If the login fails, you skip it or press Ctrl-C during it (for example after `could not prompt: unexpected escape sequence from terminal`, which some web consoles and terminals cause), setup still finishes with read-only clones and prints the command. Run that command yourself in a plain SSH terminal, where it may ask a question or two, then rerun the script. Never paste a token into the script; gh handles the sign-in.
- **Checks.** `./dev/scripts/setup.sh doctor` reports host facts, tool versions, login, remotes, hooks path, signing settings and whether the mode file fits this machine, and changes nothing. `./dev/scripts/setup.sh status` prints one row per repo (role, branch, ahead/behind trunk, uncommitted files, open pull request) and warns when the same branch name exists in several repos. For a change that spans the control plane and the daemon, link the two pull requests to each other and merge the control plane (`turbopanel`) one before the daemon (`turbopaneld`) one.

## Fresh-Clone → Working Dev

1. Run the starter one-liner, or `./dev/scripts/setup.sh` in an existing clone (see "Contribute"). It puts the six sibling repos under one parent directory on the host (`dev`, `turbopaneld`, `turbopanel`, `ui`, `website`, `.github`). `.github` is optional for `vagrant-up.sh` and the `Vagrantfile`: when it is missing, the `github-repo` Ansible role clones it inside the guest.
2. From the host `dev` checkout: `vagrant up` then `vagrant ssh` (on macOS `./scripts/vagrant-up.sh` does both).
3. Inside the guest: `turbopanel/dev/console` → prereqs, pinned Node, `pnpm install`, TUI launch (exports `TURBOPANEL_MODE=development` and `TURBOPANEL_DEV_ROOT`; a `TURBOPANEL_<DIR>_REPO` override is forwarded only when you set one).
4. **Bootstrap / converge** → on launch the console uses `resolveDevEnvStartupPlan` (`src/lib/dev-env-readiness.ts`): it **auto-bootstraps** (daemon install → systemd unit) when prerequisites are missing; after bootstrap finishes it opens the **optional services** picker, then converges (`if-needed`). When the host is already installed, launch sits **idle** with no auto-converge; use Developer → **Converge / re-converge development environment**. The picker defaults to UI, website, Mailpit and Drizzle Studio on, and Redis Insight and the Stripe CLI forwarder off; idle for 5 seconds continues with the current selection. Drizzle Studio and Mailpit stay listed on the Services screen in gray when not enabled: select the row and press **E**, or use Developer → **Optional services…**, which also starts and stops optional units at any time without a full converge. The daemon checkout, Stripe forwarder and tier catalogue are described under "Daemon Checkout, Stripe Forwarder and Tier Catalogue" below; the console internals are in [`src/AGENTS.md`](../src/AGENTS.md).
5. On the **host**, open `https://localhost:8443`; edit source in the host sibling checkouts (mounted into the guest). Prefer a LAN hostname when attaching remote test machines.

## Direct VM (Proxmox or Bare Metal)

Vagrant, Incus (see "Incus VM (Linux)") and Lima (see "Lima VM (macOS)") stay fully supported. This path is for a plain Debian 13 machine you already run, such as a Proxmox VM or a spare computer, where a VM from the host is not wanted. The Developer Console, the daemon install and the Ansible dev overlay all work under any user name you pick: they read it from the logged-in user (`tp_resolve_dev_identity()`) and keep the repos under `$HOME` (`TURBOPANEL_DEV_ROOT`). Nothing needs a `vagrant` account.

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
   - `--clone` clones `dev`, `turbopaneld`, `turbopanel`, `ui`, `website` and `.github` into `~/turbopanel/<repo>` (or `TURBOPANEL_DEV_ROOT`, which must be a folder named `turbopanel`) over HTTPS, like `setup.sh` (no SSH key or login needed), and skips any path that already exists, with a message. The clones run as your user with your git config, so a `url.<ssh>.insteadOf https://github.com/` rule still sends them over SSH; then `sudo` normally drops your forwarded SSH agent, so use `sudo --preserve-env=SSH_AUTH_SOCK sh SCRIPT --clone` when you rely on `ssh -A`, and the first SSH clone asks you to trust the github.com host key; check it yourself.
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

## Incus VM (Linux)

Incus is a third option for Linux hosts, next to Direct and Vagrant. Like Vagrant, the repos stay on the host in the folder named `turbopanel`, you edit and commit on the host, and the VM only runs the stack. It does not run on macOS, which has Vagrant and Lima.

### When to Use It

- Your host is Linux and you want the stack in a VM that is separate from your computer, without Vagrant and libvirt.
- You do not want to turn a whole Debian machine into the dev machine (that is Direct).

### Prerequisites

- A Linux host with KVM and the `turbopanel` folder set up by `dev/scripts/setup.sh --mode incus`. The mode is offered on Linux only. It writes `TURBOPANEL_DEV_ENV='incus'` in the mode file, prints install hints and installs nothing.
- Incus from your distribution's packages, initialised with `incus admin init`, and your user in the `incus-admin` group (log out and back in after adding it).
- incant, a small Vagrant-like front end for Incus: `pipx install incus-incant`. The PyPI package named `incant` is an unrelated library; do not install that one.
- Free host ports: 80, 443, 8443, 8081, 8088, 19820, 4983, 8025, 5540 and 4213. Incus's own API on 8443 or another web server on 80 clashes. Move the Incus API with `incus config set core.https_address 127.0.0.1:<other port>`.
- If Docker runs on the same host, its firewall rules can break Incus networking. See "Prevent connectivity issues with Incus and Docker" in the Incus docs.

### Steps

1. Run the starter one-liner, or `./dev/scripts/setup.sh --mode incus` in an existing clone (see "Contribute").
2. From the host `dev` checkout run `incant up`. It creates the VM, starts it and provisions it. For more memory, set it first: `TURBOPANEL_INCUS_MEMORY=10GiB incant up`. To fit 6 GiB, the guest setup lowers the Metro heap to 3 GiB (it takes effect after `sudo systemctl restart turbopanel-ui` or a reboot) and keeps `/tmp` on disk (a reboot after the first run applies it). It also disables the UI (Metro), website and Drizzle Studio units at boot, but only if they exist: on a fresh VM `incant up` runs the guest setup before the console's first bootstrap, so the units are not there yet, and the first converge (whose picker defaults them on) enables and starts them. To keep the 6 GiB budget, untick UI (Expo), Website and Drizzle Studio in the first picker (or later under Developer → Optional services), or re-run `incant provision` after the first converge. Start them by hand when you need them: `sudo systemctl start turbopanel-ui` (only for UI work), `sudo systemctl start turbopanel-website` and `sudo systemctl start turbopanel-dbstudio`. Any converge enables the selected ones again, so untick them in the picker each time. The UI unit is the Expo dev server behind Caddy: when the daemon runs the UI in dev mode (the default; `TURBOPANEL_UI_MODE=static` serves the built UI instead), the web panel on 8443 shows only the loading page until you start it. The platform converge itself does not need it.
3. Set a password for your guest user (see "Password Step").
4. Open a shell in the VM and start the console: `incus exec turbopanel-dev -- su -l <you>`, then `~/turbopanel/dev/console`.

`incant provision` re-runs provisioning. `incant destroy` removes the VM; the repos on the host are untouched.

The config is [`incant.yaml.mako`](../incant.yaml.mako), a Mako template that incant renders. Defaults, all overridable by environment variable before `incant up`:

| Setting | Default | Variable |
| --- | --- | --- |
| Name | `turbopanel-dev` | `TURBOPANEL_INCUS_NAME` |
| Image | `images:debian/13` | |
| CPUs | 2 | `TURBOPANEL_INCUS_CPUS` |
| Memory | 6 GiB | `TURBOPANEL_INCUS_MEMORY` |
| Disk | 64 GiB | |
| Address | `.10` in the bridge subnet | `TURBOPANEL_INCUS_IPV4` |
| Bridge | | `TURBOPANEL_INCUS_BRIDGE` |
| LAN bridge (bridged mode) | unset (NAT) | `TURBOPANEL_INCUS_LAN_BRIDGE` |
| Hostname (bridged mode) | the instance name | `TURBOPANEL_INCUS_HOSTNAME` |

The VM is a KVM virtual machine, not a container: Docker, systemd, swap and firewall rules need a full VM (see "Why Not LXC"). Metro is capped at a 3 GiB heap in the guest, so raise the memory if the 6 GiB default is tight.

The guest user has the same name and UID as your host user, so files on the shared folders keep their owner. It has passwordless sudo and is in the `sudo` group.

### Editing Model

Same as Vagrant. Edit and commit on the host. Each sibling repo is an Incus disk device (virtiofs) at `~/turbopanel/<repo>` in the guest. The host has no Node or Deno tree, so host commit hooks run only the secret scan; format your changed files inside the VM before you commit.

### Ports

The same ten ports as the Vagrantfile: 80, 443, 8443, 8081, 8088, 19820, 4983, 8025, 5540 and 4213. Incus forwards into a VM only in NAT mode, to the guest's bridge address, so the guest redirects those ports to its own `127.0.0.1` (`turbopanel-incus-forward.service`, nftables plus `route_localnet` inside the guest).

All ten listen on every host address. That includes 4983, 8025, 5540 and 4213, which Vagrant keeps on loopback. Those are unauthenticated dev tools (the database browser, the mail catcher and Redis Insight) and they are reachable from your LAN. Use this only on a network you trust.

Use the host's LAN name or address, for example `https://<host>:8443`, not `localhost`: the host's loopback does not reach the VM.

### Bridged LAN Mode (Opt In)

Set `TURBOPANEL_INCUS_LAN_BRIDGE=<host bridge>` (for example `br0`) before `incant up` to put the VM straight on your LAN instead of the Incus NAT bridge:

```bash
TURBOPANEL_INCUS_LAN_BRIDGE=br0 TURBOPANEL_INCUS_HOSTNAME=turbopanel-dev.example.lan incant up
```

- The network card is `nictype: bridged` on that host bridge (the host needs a Linux bridge with your LAN card in it). There is no fixed address: the VM takes one by DHCP from your LAN, and `TURBOPANEL_INCUS_IPV4` and `TURBOPANEL_INCUS_BRIDGE` are ignored.
- No host ports are forwarded. Clients use the VM's own address or name, for example `https://turbopanel-dev.example.lan:8443`.
- The VM sends its hostname in its DHCP request (systemd-networkd does this by default), so a LAN router that registers DHCP names resolves `<hostname>.<your LAN domain>`. `TURBOPANEL_INCUS_HOSTNAME` is the short hostname or a full name; with a dotted name the first label becomes the hostname and the whole name goes on the dev certificate. Without it the instance name is the hostname and `<name>.lan` goes on the certificate (add your real domain with `TURBOPANEL_DEV_LAN_ALIASES`). The host's own address is not added to the certificate in this mode.
- The guest redirect (`turbopanel-incus-forward.service`) works the same: it matches traffic arriving on the guest's default-route card, which is `eth0` here.
- Security: 4983 (Drizzle Studio), 8025 (Mailpit), 5540 (Redis Insight) and 4213 (DuckDB UI) are unauthenticated dev tools. In this mode they are reachable by every machine on the LAN at the VM's own address. Use it only on a network you trust.

Switching an existing VM. Run on the host; replace `turbopanel-dev` and `br0`. These commands were checked on a live VM with an instance-level `eth0`:

```bash
incus stop turbopanel-dev
for p in 80 443 8443 8081 8088 19820 4983 8025 5540 4213; do incus config device remove turbopanel-dev port-$p; done
incus config device remove turbopanel-dev eth0    # only if eth0 is an instance-level device
incus config device add turbopanel-dev eth0 nic nictype=bridged parent=br0 name=eth0
incus start turbopanel-dev
```

Why remove and add: a profile's `eth0` usually names a managed network (`network: incusbr0`), and `network` cannot be combined with `nictype`. Removing an instance-level `eth0` (one that carries `network:` and `ipv4.address:`) makes the profile's card show through; the `add` then replaces it with an instance-level bridged card. When `eth0` comes only from the profile, skip the remove line. The guest's own interface name (for example `enp5s0`) does not change.

The new card has a new MAC address, so the guest still holds its old lease and the router has no record of the new card. Inside the VM, take a fresh lease with `sudo networkctl reconfigure <interface>` (the default-route card, see `ip route`). `networkctl renew` keeps the old lease and is not enough. Then rerun the guest setup with the bridged-mode settings: `TURBOPANEL_INCUS_LAN_BRIDGE=br0 TURBOPANEL_INCUS_HOSTNAME=turbopanel-dev incant provision` (this renders the config without the ports, sets the hostname and, only when the hostname changed, updates `/etc/hosts` and takes a fresh lease, then reruns the guest setup). The guest's forward rule matches the default-route card by name, so it works unchanged in bridged mode. To go back to NAT, remove the bridged `eth0`, add the proxy devices and the `eth0` device with `network` and `ipv4.address` again, or destroy and recreate the VM.

### Password Step

No password is set for the guest user. Before the first panel install, run `incus exec -t turbopanel-dev -- passwd <you>`. The panel installer checks that password (on Vagrant it was `vagrant`/`vagrant`).

### Running the Test Suites

Tests run inside the VM, never on the host:

```bash
incus exec turbopanel-dev -- su -l <you> -c 'export PATH="/opt/turbopanel/vendor/node/current/bin:/opt/turbopanel/vendor/deno/current:$PATH"; cd ~/turbopanel/dev && pnpm test'
```

### What `incus-guest-setup.sh` Does

Provisioning runs `scripts/vm-bootstrap.sh --upgrade --swap --lan-alias <host LAN IP>` (the Direct-mode script), then `scripts/incus-guest-setup.sh`, which adds what only shared folders need (the same as the Vagrant guest):

- A guest-local pnpm store.
- Guest-local `node_modules` bind mounts (systemd `turbopanel-virtfs-node-modules.service`).
- A 2-second Metro poll interval: `TURBOPANEL_METRO_POLL_MS=2000` as a systemd drop-in for `turbopanel-ui`. The default 400 ms full-tree poll cost about 40% of a core.
- The port redirects to the guest's `127.0.0.1` (`turbopanel-incus-forward.service`, see "Ports").

## Lima VM (macOS)

Lima is a third option for macOS hosts, next to Vagrant (UTM). Like Incus on Linux, the repos stay on the host in the folder named `turbopanel`, you edit and commit on the host, and the VM only runs the stack. The VM is Debian 13 on Apple's virtualization framework, so it matches the Linux guests (the UTM guest is still Debian 12).

### Prerequisites

- A Mac with Apple silicon or Intel and the `turbopanel` folder set up by `dev/scripts/setup.sh --mode lima`. The mode is offered on macOS only. It writes `TURBOPANEL_DEV_ENV='lima'` in the mode file, prints an install hint when Lima is missing and installs nothing.
- Lima: `brew install lima`.
- Free host ports for what the stack serves: 80, 443, 8443, 8081, 19820, 4983, 8025, 5540 and 4213.

### Steps

1. Run the starter one-liner, or `./dev/scripts/setup.sh --mode lima` in an existing clone (see "Contribute").
2. From the host `dev` checkout run `./scripts/lima-up.sh`. The first run creates the VM from [`lima.yaml`](../lima.yaml), starts it and provisions it (a download of Debian 13 and a few minutes of apt). Later runs start the VM if it is stopped.
3. Set a password for your guest user: `limactl shell turbopanel-dev -- sudo passwd <you>` (the panel installer checks it through PAM).
4. Open a shell and start the console: `limactl shell turbopanel-dev`, then `~/turbopanel/dev/console`.

`limactl stop turbopanel-dev` stops the VM and `limactl delete -f turbopanel-dev` removes it; the repos on the host are untouched. Defaults, all overridable by environment variable before `lima-up.sh`:

| Setting | Default | Variable |
| --- | --- | --- |
| Name | `turbopanel-dev` | `TURBOPANEL_LIMA_NAME` |
| CPUs | 2 | `TURBOPANEL_LIMA_CPUS` |
| Memory | 4 GiB | `TURBOPANEL_LIMA_MEMORY` |
| Disk | 64 GiB (sparse) | `TURBOPANEL_LIMA_DISK` |

Sizes apply when the VM is created; to change them later run `limactl stop`, `limactl edit` and `limactl start`. Set `TURBOPANEL_LIMA_NAME` in your shell profile when you use another name: `ci-verify.sh`, `game-day.sh` and the printed next steps read it. Metro is capped at a 3 GiB heap in the guest and is off at boot, so raise the memory (for example `TURBOPANEL_LIMA_MEMORY=8GiB`) for UI work.

The guest user has the same name and UID as your host user and passwordless sudo, but its home folder is `/home/<you>.guest`, not the host's `/Users/<you>`.

### Mode File and the Guest

The mode file sits in the shared folder, so the VM sees it too. Never run `setup.sh` inside the VM: it would rewrite the file with `direct` and the guest path. Provisioning calls `scripts/vm-bootstrap.sh` and `scripts/lima-guest-setup.sh` directly (the Incus way), and the console in the VM finds the folder that holds the mode file when `dev_root` names the host path (it warns and the folder wins).

### Editing Model

Same as Incus. Edit and commit on the host. The host folder is one writable virtiofs mount at `~/turbopanel` in the guest. Only that folder is shared: Lima's default read-only mount of your whole home folder is not used, so `lima.yaml` builds on the image-only base template. SSH agent forwarding is on, so the guest can use your GitHub key. The host has no Node or Deno tree, so host commit hooks run only the secret scan; format your changed files inside the VM before you commit.

### Ports

Lima forwards every TCP port a guest service listens on, including loopback-only ones, to `127.0.0.1` on the Mac. Open `https://localhost:8443` for the panel. Nothing is exposed on your LAN, and there is no port list to keep.

### Running the Test Suites

Tests run inside the VM, never on the host:

```bash
./scripts/ci-verify.sh   # re-execs through limactl shell when the mode file says lima
limactl shell turbopanel-dev -- sh -c 'export PATH="/opt/turbopanel/vendor/node/current/bin:/opt/turbopanel/vendor/deno/current:$PATH"; cd ~/turbopanel/dev && pnpm test'
```

### What `lima-guest-setup.sh` Does

`lima.yaml` runs it once, as root, on the first boot. It installs `libatomic1` and `jq`, runs `scripts/vm-bootstrap.sh --swap` (the Direct-mode script), then `scripts/incus-guest-setup.sh` without ports (the guest-local pnpm store, the `node_modules` bind mounts, the Metro poll interval and heap, optional units off at boot), links the host's `dev_root` path to `~/turbopanel` inside the VM so git worktrees work, and installs the login banner. Every step checks first, so rerun it after a failure: `limactl shell turbopanel-dev -- sudo sh ~/turbopanel/dev/scripts/lima-guest-setup.sh <you>`.

## Vagrantfile Responsibilities

- **`Vagrantfile`** — host-aware libvirt/UTM provider config, bidirectional VirtioFS/VirtFS mounts of the five workspace repos plus optional `.github`, SSH agent forwarding, port forwards `80`/`443` (hosting Caddy) / `8443`/`8081`/`8088`/`19820` (LAN `0.0.0.0`) plus loopback-only `4983`/`8025`/`5540`/`4213`, all with `guest_ip: 127.0.0.1`, and idempotent shell
provision split as `system-upgrade` → `turbopanel_reboot_if_needed` → `guest-setup` → `sshd-port-forward-keepalives` (`run: always`) → `guest-motd` (`run: always`) → `turbopanel_ensure_libvirt_port_forwards` (`run: always`). Upgrades run `apt-get update` + `upgrade` + `autoremove` + `curl` and set the `vagrant` login password; when Debian leaves `/var/run/reboot-required` or the running kernel differs from the newest `/boot/vmlinuz-*`, the reboot provisioner prints that SSH will drop for about a minute, reboots via the guest reboot capability (Vagrant waits for SSH), **remounts VirtioFS synced folders** (mid-provision reboot otherwise leaves empty `~/turbopanel/dev` mount-point dirs — Vagrant only mounts shares on `up`/`reload`), then `guest-setup` finishes (passwordless sudo, `/etc/profile.d/turbopanel-vagrant.sh`, pnpm's `~/.config/pnpm/config.yaml` pointing `storeDir` at guest-local `/var/lib/pnpm/store`, per-repo `node_modules` **bind mounts** from `/var/lib/turbopanel-dev/node_modules/<repo>/node_modules` (systemd `turbopanel-virtfs-node-modules.service` at boot), 8 GiB `/swapfile`). **Libvirt port forwards are SSH `-L` tunnels** (not QEMU `hostfwd`); guest reboot / sshd restart / OpenSSH 9.8+ `UnusedConnectionTimeout` drop idle one-shot vagrant-libvirt `ssh -N` sessions. `sshd-port-forward-keepalives` writes `/etc/ssh/sshd_config.d/turbopanel-vagrant.conf` (`UnusedConnectionTimeout 0` when the guest sshd supports it; `PrintMotd no` so PAM owns the banner). `guest-motd` replaces Debian's default login MOTD with the official T-mark banner from `scripts/guest/motd.sh` (`/etc/motd.d/10-turbopanel`, empty `/etc/motd`, stock `update-motd.d` fragments chmod `-x`) — safe while `./console` is up. `turbopanel_ensure_libvirt_port_forwards` then replaces those one-shot tunnels with a restarting `ssh_forward_supervisor.sh` per port (health = host TCP listen plus our supervisor pid, not leftover libvirt ssh; host **80**/**443** wrap the supervisor in `sudo -n` when `net.ipv4.ip_unprivileged_port_start` still blocks the bind). Heal without a full reload: `vagrant provision --provision-with sshd-port-forward-keepalives,guest-motd,turbopanel_ensure_libvirt_port_forwards` (do not run a full `vagrant provision` while `./console` is up — that re-runs guest-setup). Linux defaults to libvirt + `debian/trixie64`; macOS defaults to UTM + `utm/bookworm`. Does not clone platform repos or run `./console`. Why bind-mount `node_modules`: on ARM64, FUSE-backed filesystems (9p/virtiofs, which is how UTM VirtFS is implemented) don't invalidate the instruction cache for pages faulted in from mmap'd executable files, so native Node addons (esbuild, `@rolldown/binding-*`, lightningcss, ...) crash with `SIGSEGV`/`SIGILL` when `node_modules` lives directly on the VirtFS mount — the pnpm store already being local isn't enough, since `packageImportMethod: copy` still writes the actual files into `node_modules` on the mount. A **symlink** is not enough: Next.js Turbopack rejects `node_modules` that points outside the project (`Symlink [project]/node_modules is invalid, it points out of the filesystem root`), and Node ESM/CJS realpath walks miss packages unless the physical path ends in a directory named `node_modules` (flat `<repo>/drizzle-orm` makes `drizzle-kit` fail with "Please install latest version of drizzle-orm"; other tools fail with `Cannot find module 'typescript'`). The provisioner runs for every mounted repo with a `package.json` (`dev`, `turbopanel`, `ui`, `website`; `turbopaneld` has none) and is idempotent across `vagrant provision` re-runs. On boot, its helper waits for all four Vagrant shares to expose `package.json` before binding—the shares are mounted over SSH after userspace starts, so an immediate check can otherwise exit successfully without mounting anything—and dbstudio/UI/website/instance units are ordered after it. Ansible `instance-repo` / `ui-repo` / `website-repo` must probe a nested package (`drizzle-kit`, `expo`, `next`) before skipping `pnpm install` — the mount point exists while the guest tree is still empty. A provisioner layout change wipes a flat tree; the next `pnpm install` (console for `dev`, converge for the others) refills it from the guest pnpm store. Do not `vagrant provision` while `./console` is running if that would rebuild the `dev` tree.

## Daemon Checkout, Stripe Forwarder and Tier Catalogue

- **Daemon checkout:** `installDaemon` (`src/lib/platform-install.ts`) uses an existing `~/turbopanel/turbopaneld` as it is when it holds `main.ts` or `orchestration/ansible.cfg`, which is the case for Vagrant mounts and pre-cloned siblings. It never clones or pulls into a usable tree, and clones over SSH only when the path is missing. A path that exists but holds neither marker is an error.
- **Stripe forwarder:** the daemon role `stripe-listen` installs the `turbopanel-stripe-listen` service, which forwards sandbox events to the instance's `/webhook/stripe`. It applies only to the Workers runtime. The role seeds `/etc/turbopanel/stripe-listen/stripe.env` once with empty values and never overwrites it. Paste a test-mode `TURBOPANEL_STRIPE_SECRET_KEY` into it by hand; nothing generates it and it is never committed. With the key blank the forwarder exits with a pointer to that file. The webhook signing secret in the same file is rewritten by the wrapper on every start.
- **Tier catalogue:** `local/tiers.json` (gitignored; see `local/README.md`) holds the billing tiers a superadmin bound to payment-provider products. `src/lib/save-dev-tier-catalogue.ts` writes it. The dev overlay role `dev-tier-catalogue` restores it on a Workers-runtime converge, only when the database holds no priced tier row. The unpriced `SX` row does not count, a label already present is skipped, and the instance and daemon repos know nothing of it.

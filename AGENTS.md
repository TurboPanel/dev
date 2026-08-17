# AGENTS.md

## What this repo is

The **dev** repository ([turbopanel/dev](https://github.com/turbopanel/dev)) is the **TurboPanel Development Environment** — contributor tooling only, not production or self-hosted install. It is a minimal terminal UI built on [Ink](https://github.com/vadimdemedes/ink) 7, run on **Node** via **Vite (`vite-node`)**. Watch mode uses a custom Vite dev runner (`scripts/hot-reload.tsx`) that keeps the Ink process mounted and reloads changed `src/` modules. Contributors run it inside a **Vagrant** guest with six sibling checkouts mounted from the host (`dev`, `turbopaneld`, `turbopanel`, `ui`, `website`, `.github`).

**License:** AGPL-3.0-only. **Maturity:** **Private alpha**. README is product-facing; AGENTS.md is maintainer-facing.

**This repo runs on Node, not Deno.** In dev the console bootstraps
orchestration and runs the **daemon from the dev user's home checkout**
(`~/turbopaneld`, resolved via `TURBOPANEL_DEV_ROOT` / `TURBOPANEL_DAEMON_REPO`) via Deno (`deno run main.ts`) — host Deno is
preferred, else the vendored runtime at
`/opt/turbopanel/vendor/deno/current/deno`. It never runs a
compiled daemon binary. Production installs (driven by `run.sh` + Ansible, **not**
this console) run **`turbopaneld.service`** on the FHS tree
(`/etc/turbopanel`, `/var/lib/turbopanel`, `/var/log/turbopanel`,
`/run/turbopanel`): native **`/opt/turbopanel/bin/turbopaneld`** when that binary
executes, otherwise **`turbopaneld.js`** via vendored Deno — the supported path
on hosts where the native binary cannot load (e.g. some Raspberry Pi kernels with
16 KiB pages; see the daemon repo's `AGENTS.md` → "Filesystem layout & path
model"). Deno is still installed for the **instance** stack (and mailer) via the
`deno-runtime` Ansible role during dev converge.

**Target host:** Debian 13 (Trixie) inside the Vagrant guest. **Linux
contributors** use **Vagrant + libvirt** with the `debian/trixie64` box; **macOS
contributors** use **Vagrant + UTM** with guest box **`utm/bookworm`** (Debian
12) until a Trixie UTM box is available.

Canonical docs: https://turbopanel.io/docs/getting-started/development

**Vagrant:** root [`Vagrantfile`](./Vagrantfile) +
[`scripts/vagrant-up.sh`](./scripts/vagrant-up.sh). Plain `vagrant up`
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
FHS trees stay **guest-local**. The optional macOS launcher does
`vagrant up --provider=utm` then `vagrant ssh -t` into `./console` (not
provisioned interactively). Ports `8443` / `8880` / `8081` / `8088` / `19820` forward
to the host on `0.0.0.0` (LAN-reachable, not localhost-only). Drizzle Studio
`4983`, Mailpit `8025`, Redis Insight `5540`, and Tabix `8125` are loopback-only
on both sides of the forward (`127.0.0.1` host and guest): those APIs are
unauthenticated. The hosted HTTPS Studio UI must use `?host=localhost` rather
than a private hostname such as `studio.lan`. All forwards target **guest
loopback** so they still work when the libvirt DHCP address changes.

The current entrypoint is a minimal launcher only (full multi-screen console was removed during a rewrite).

## Filesystem layout

```
~/dev/                    # turbopanel/dev checkout (Vagrant mounts host sibling here)
├── Vagrantfile           # libvirt/UTM guest: mounts + port forwards + light provision
├── console               # ensure Node, pnpm install, launch the TUI via vite-node
├── orchestration/        # Ansible dev overlay + development Caddyfile
│   ├── Caddyfile         # co-located control-plane proxy (Expo, :8880, wrangler)
│   └── expo-loading.html # Expo cold-start page served by the development Caddyfile
├── scripts/vagrant-up.sh # optional macOS: vagrant up then ssh into ./console
├── package.json          # Node project (pnpm, pinned via packageManager); ink + react + vite
├── src/tui.tsx           # Ink entrypoint
└── …

~/turbopaneld/                 # TURBOPANEL_DAEMON_REPO (default: $TURBOPANEL_DEV_ROOT/turbopaneld)
~/turbopanel/               # TURBOPANEL_INSTANCE_REPO
~/ui/                     # TURBOPANEL_UI_REPO
~/website/                # TURBOPANEL_WEBSITE_REPO
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

Node is a pinned `nodejs.org` tarball vendored under `/opt/turbopanel/vendor/node/<version>/` with a `current` symlink (same layout as deno/caddy). pnpm is provisioned via Corepack and pinned by the `packageManager` field in `package.json`. Deno is **host-provided in development** (preferred) or bootstrap-installed to `/opt/turbopanel/vendor/deno/current/deno` when host Deno is absent; the dev console always runs the daemon and orchestration **from the source checkout** via Deno. Production daemon installs use native `/opt/turbopanel/bin/turbopaneld` or, when that binary cannot execute on the host, `turbopaneld.js` via vendored Deno — driven by `run.sh` + Ansible, never by this console.

## Fresh-clone → working dev

1. Clone (or fork) the six sibling repos under one parent directory on the host (`dev`, `turbopaneld`, `turbopanel`, `ui`, `website`, `.github`).
2. From the host `dev` checkout: `vagrant up` then `vagrant ssh`.
3. Inside the guest: `cd ~/dev && ./console` → prereqs, pinned Node, `pnpm install`, TUI launch (exports `TURBOPANEL_MODE=development`, `TURBOPANEL_DEV_ROOT`, `TURBOPANEL_<DIR>_REPO`).
4. **Bootstrap / converge** → the console uses `resolveDevEnvStartupPlan` (`src/lib/dev-env-readiness.ts`) on launch: **auto-bootstraps** (daemon install → systemd unit) when prerequisites are missing; after bootstrap finishes it opens the **optional services** picker then converges (`if-needed`). When the host is already installed, launch sits **idle** — no auto-converge (use Developer → **Converge / re-converge**). The converge picker defaults to UI + website + Mailpit on (Drizzle Studio, Redis Insight, and Tabix off); idle for 5s continues with the current selection. Drizzle Studio, Mailpit, and Tabix stay listed on the Services screen in gray when not enabled — select the row and press **E**, or use Developer → **Optional services…**. That menu also starts/stops optional units anytime without a full converge. Daemon bootstrap (`installDaemon` in `src/lib/platform-install.ts`) **uses an existing usable checkout** when `~/turbopaneld` already has `main.ts` or `orchestration/ansible.cfg` (Vagrant VirtFS mounts and pre-cloned siblings — no guest-side clone/pull; Git may also refuse mounted trees via `safe.directory`); it only **clones** when that path is missing. Bootstrap then writes `/etc/turbopanel/daemon.env`, runs the `dev/orchestration` overlay (runtimes into `/opt/turbopanel/vendor`, systemd units + Docker (postgres/redis/rabbitmq/mailpit) as the dev user, mutable data under FHS trees dev-user-owned; no `tp` / `tpctrl` / `tpcache` accounts created).
5. On the **host**, open `https://localhost:8443` (or `http://localhost:8880`); edit source in the host sibling checkouts (mounted into the guest). Prefer a LAN hostname when attaching remote test machines.

## Entry points

| Script | Purpose |
|--------|---------|
| `vagrant up` / `vagrant ssh` | **Canonical:** boot guest from `dev/`, then SSH in and run `./console`. |
| `./scripts/vagrant-up.sh` | **Optional macOS:** `vagrant up --provider=utm`, then SSH into guest `./console`. |
| `./console` | Ensure pinned Node (sudo on first run), `pnpm install`, launch `src/tui.tsx` via `vite-node` (run **inside the guest**). |
| `./console --watch` | Same, but use `scripts/hot-reload.tsx` for live reload on `src/` changes. |
| `pnpm dev` | Run `src/tui.tsx` directly via `vite-node` (requires Node on PATH). |
| `pnpm dev:watch` | Run `scripts/hot-reload.tsx`, which keeps Ink mounted and rerenders on `src/` changes. |
| `./scripts/sync.sh` | Push `turbopanel/src/lib/db/schema.ts` → live Postgres (drizzle-kit push; Deno dev convenience). |
| `./scripts/introspect.sh` | Pull live Postgres → `turbopanel/src/lib/db/schema.ts` (drizzle-kit introspect). |

**Typical flow:**

```bash
# siblings: …/turbopanel/{dev,turbopaneld,turbopanel,ui,website,.github}
cd …/turbopanel/dev
vagrant up
vagrant ssh
# inside guest:
cd ~/dev && ./console
```

## Responsibilities

- **`scripts/vagrant-up.sh`** — optional host-side Mac entry: requires Vagrant + `vagrant_utm`, checks sibling checkouts, warns if the SSH agent looks empty, runs `vagrant up --provider=utm`, then `exec vagrant ssh -- -t` into `./console` on the guest. Does not provision the interactive TUI inside Vagrant (TTY must come from the host SSH session).
- **`Vagrantfile`** — host-aware libvirt/UTM provider config, bidirectional VirtioFS/VirtFS mounts of the five workspace repos plus optional `.github`, SSH agent forwarding, port forwards `8443`/`8880`/`8081`/`8088`/`19820` (LAN `0.0.0.0`) plus loopback-only `4983`/`8025`/`5540`/`8125`, all with `guest_ip: 127.0.0.1`, and idempotent shell
provision split as `system-upgrade` → `turbopanel_reboot_if_needed` → `guest-setup` → `sshd-port-forward-keepalives` (`run: always`) → `turbopanel_ensure_libvirt_port_forwards` (`run: always`). Upgrades run `apt-get update` + `upgrade` + `autoremove` + `curl` and set the `vagrant` login password; when Debian leaves `/var/run/reboot-required` or the running kernel differs from the newest `/boot/vmlinuz-*`, the reboot provisioner prints that SSH will drop for about a minute, reboots via the guest reboot capability (Vagrant waits for SSH), **remounts VirtioFS synced folders** (mid-provision reboot otherwise leaves empty `~/dev` mount-point dirs — Vagrant only mounts shares on `up`/`reload`), then `guest-setup` finishes (passwordless sudo, `/etc/profile.d/turbopanel-vagrant.sh`, pnpm's `~/.config/pnpm/config.yaml` pointing `storeDir` at guest-local `/var/lib/pnpm/store`, per-repo `node_modules` **bind mounts** from `/var/lib/turbopanel-dev/node_modules/<repo>/node_modules` (systemd `turbopanel-virtfs-node-modules.service` at boot), 8 GiB `/swapfile`). **Libvirt port forwards are SSH `-L` tunnels** (not QEMU `hostfwd`); guest reboot / sshd restart / OpenSSH 9.8+ `UnusedConnectionTimeout` drop idle one-shot vagrant-libvirt `ssh -N` sessions. `sshd-port-forward-keepalives` writes `/etc/ssh/sshd_config.d/turbopanel-vagrant.conf` (`UnusedConnectionTimeout 0` when the guest sshd supports it). `turbopanel_ensure_libvirt_port_forwards` then replaces those one-shot tunnels with a restarting `ssh_forward_supervisor.sh` per port (health = host TCP listen plus our supervisor pid, not leftover libvirt ssh). Heal without a full reload: `vagrant provision --provision-with sshd-port-forward-keepalives,turbopanel_ensure_libvirt_port_forwards` (do not run a full `vagrant provision` while `./console` is up — that re-runs guest-setup). Linux defaults to libvirt + `debian/trixie64`; macOS defaults to UTM + `utm/bookworm`. Does not clone platform repos or run `./console`. Why bind-mount `node_modules`: on ARM64, FUSE-backed filesystems (9p/virtiofs, which is how UTM VirtFS is implemented) don't invalidate the instruction cache for pages faulted in from mmap'd executable files, so native Node addons (esbuild, `@rolldown/binding-*`, lightningcss, ...) crash with `SIGSEGV`/`SIGILL` when `node_modules` lives directly on the VirtFS mount — the pnpm store already being local isn't enough, since `packageImportMethod: copy` still writes the actual files into `node_modules` on the mount. A **symlink** is not enough: Next.js Turbopack rejects `node_modules` that points outside the project (`Symlink [project]/node_modules is invalid, it points out of the filesystem root`), and Node ESM/CJS realpath walks miss packages unless the physical path ends in a directory named `node_modules` (flat `<repo>/drizzle-orm` makes `drizzle-kit` fail with "Please install latest version of drizzle-orm"; Tamagui fails with `Cannot find module 'typescript'`). The provisioner runs for every mounted repo with a `package.json` (`dev`, `turbopanel`, `ui`, `website`; `turbopaneld` has none) and is idempotent across `vagrant provision` re-runs. On boot, its helper waits for all four Vagrant shares to expose `package.json` before binding—the shares are mounted over SSH after userspace starts, so an immediate check can otherwise exit successfully without mounting anything—and dbstudio/UI/website/instance units are ordered after it. Ansible `instance-repo` / `ui-repo` / `website-repo` must probe a nested package (`drizzle-kit`, `expo`, `next`) before skipping `pnpm install` — the mount point exists while the guest tree is still empty. A provisioner layout change wipes a flat tree; the next `pnpm install` (console for `dev`, converge for the others) refills it from the guest pnpm store. Do not `vagrant provision` while `./console` is running if that would rebuild the `dev` tree.
- **`console`** — runs the prerequisite check, ensures pinned **Node** (`/opt/turbopanel/vendor/node/current/bin/node`, runs this repo) is installed, enables Corepack/pnpm, runs `pnpm install`, and launches the Ink TUI via `vite-node`. Add `--watch` to use `scripts/hot-reload.tsx`, which keeps the Ink process alive and rerenders when imported `src/` modules change. When stdin/stdout/stderr are not TTYs, reattaches stdio to `/dev/tty` when `tp_is_interactive()` succeeds. Does **not** install Deno via `./console` itself (Deno bootstrap is via `ensureBootstrapDeno` during daemon install).
- **`src/tui.tsx`** — minimal Ink app: full-height shell with a one-row `MenuBar`, a bordered `MainPanel`, and a one-row `StatusBar`. `← →` switches areas; Ctrl-C exits. Uses `alternateScreen`. No stack orchestration or platform install yet — rebuild features in `src/` incrementally.

## Node app

```
src/
├── tui.tsx               # entry: render() + App (full-height shell, ← → areas)
└── components/
    ├── menu-bar.tsx      # top row: title + area tabs
    ├── area-tabs.tsx
    ├── main-panel.tsx    # bordered center (flex-grow)
    └── status-bar.tsx    # bottom row: key hints
```

- Run via `vite-node` (Node). Normal mode enters through `src/tui.tsx`; watch mode enters through `scripts/hot-reload.tsx`, which hot-loads `src/app.tsx` through the Vite module graph and rerenders the existing Ink instance. Keep interactive shell state in `scripts/hot-reload.tsx` or another stable runtime layer if it must survive UI edits.
- The `@turbopanel/components/` import alias is defined in **both** `vite.config.ts` (`resolve.alias`) and `tsconfig.json` (`paths`) — keep them in sync.
- Keep the CLI **simple**. Platform repo install, service monitoring, and stack actions belong in the Ink app when rebuilt — not new shell scripts.
- **`src/lib/paths.ts`** — `TURBOPANEL_TRUNK_BRANCH` (`trunk`) is the dev shim for git checkouts and `TURBOPANEL_TRUNK_BRANCH` in `/etc/turbopanel/daemon.env`; release/binary installs omit it. Path helpers: `resolveDevRoot()`, `platformRepoPath()`, `TURBOPANEL_DEV_ROOT`, `TURBOPANEL_<DIR>_REPO` env overrides. Mutable data: `CONFIG_DIR=/etc/turbopanel`, `LOG_DIR=/var/log/turbopanel`, `RUNTIMES_DIR=/opt/turbopanel/vendor`. Daemon: `DAEMON_ENV_PATH=/etc/turbopanel/daemon.env`, `DAEMON_LOG_PATH`/`DAEMON_ERR_LOG_PATH`=`/var/log/turbopanel/daemon.log` + `daemon.err.log`. Console logs: `consoleLogDir()` → `~/.local/console`. `DENO_VERSION` (**`2.9.5`**) is the console's bootstrap fallback + status label and **must** match `deno_version` in the daemon's `deno-runtime` role (pinned by the daemon's `src/orchestration/paths.test.ts`). The daemon systemd unit name is **`turbopaneld`** (`DAEMON_SYSTEMD_UNIT`), matching the daemon's `install-daemon-systemd.sh` and managed production installs.
- **`src/lib/developer-client.ts`** — `readInstanceSecret()` resolves the Local-Console HMAC key from the **current (first) entry of `/etc/turbopanel/instance/.instance_secrets`** when that file exists, falling back to `.instance_secret` only on `ENOENT` — a present-but-unreadable keyring must not silently sign with the legacy key. **Why:** `turbopanel/src/developer/local-console-auth.ts` verifies against `versioned[0]` only, so without this the console would 401 after any rotation.
- **`src/lib/daemon-exec.ts`** — always resolves a **Deno** invocation of the source-checkout scripts (`scripts/bootstrap-orchestration.ts`, `scripts/run-orchestration-action.ts`): host Deno if on PATH, else `/opt/turbopanel/vendor/deno/current/deno`. `ensureOrchestrationDenoBin` now runs before every orchestration invocation (`runOrchestrationAction` in `src/lib/instance-install.ts`), so Deno self-heals on Converge/playbook actions, not just daemon bootstrap. It never runs `/opt/turbopanel/bin/turbopaneld` or `turbopaneld.js`; those managed/production ExecStart modes are outside this console. Deno install/upgrade logic still must **not** live in `./console` or `scripts/lib/runtime.sh` — those stay Node-only; the ensure step is orchestration-path only. `ensureBootstrapDeno` vendors from **`dl.deno.land`** (same CDN as daemon `run.sh` / `deno-runtime`), not `github.com/.../releases/download` (flaky 503s from VMs).
- **Dev environment readiness** — `src/lib/dev-env-readiness.ts` exports `resolveDevEnvStartupPlan`: **bootstrap** when checkout/Deno/ansible/unit are missing; otherwise **idle** (no auto-converge on launch). Wired from `initialAutoInstallState()` / `useConsoleApp`. Converge is explicit via Developer → Converge (optional-services picker first) or the post-bootstrap chain. Preferences live in `~/.local/console/optional-services.json` (`src/lib/optional-dev-services.ts`). Drizzle Studio, Mailpit (`smtp`), and Tabix remain on the Services list in gray when deselected; **E** / **X** persist into that prefs file so the next converge does not revert them. Picker defaults: UI, website, and Mailpit on; Drizzle Studio, Redis Insight, and Tabix off.
- **`instance-dev-install --if-needed`** — `installDevEnvironment(..., mode)` defaults to `"force"` for legacy callers (reset/provisioner) and for Developer → **Converge / re-converge** (`start-dev-env`). Uses `"if-needed"` for the daemon-install-finished chain (`handleDaemonInstallDone` → optional-services picker → `startDevEnvConverge("if-needed")`). Force mode sets `TURBOPANEL_FORCE_CONVERGE=1` via `orchestrationEnv()` so the daemon playbook always runs; `if-needed` lets the daemon skip when the converge stamp matches (see `../turbopaneld/AGENTS.md`). Optional tooling flags (`TURBOPANEL_OPTIONAL_*`) are passed as Ansible extra-vars so deselected units (dbstudio / mailpit / ui / website / redis-insight / tabix) stay stopped.
- **Cell trace (Developer area)** — the Developer menu (`src/lib/daemon-actions.ts` → `toggle-cell-trace` / `view-cell-trace` actions, dispatched in `src/hooks/use-console-app.ts`) lets you enable/disable verbose cell tracing and view it. The toggle (`src/lib/instance-trace-env.ts` — `readCellTraceEnabled`/`setCellTraceEnabled`) writes `TURBOPANEL_DAEMON_DEBUG` into **both** `/etc/turbopanel/instance/runtime.env` and `runtime.dev-vars` (so it applies to Deno and the Workers `wrangler dev` DO identically) and then restarts `turbopanel-instance` (reusing the existing restart-overlay flow) to apply it. The **Cell trace** viewer (`src/components/cell-trace-view.tsx`, `src/hooks/use-cell-trace-log.ts`, `src/lib/cell-trace-log.ts`) is a Developer sub-view that tails and filters the instance log (`/var/log/turbopanel/instance/instance.log` + `.err.log`) down to the `daemon-cell`/`command-consumer`-tagged trace lines, reached via the `view-cell-trace` action and rendered by `src/components/developer-panel.tsx`. Enabling `TURBOPANEL_DAEMON_DEBUG` now also surfaces per-call-site Durable Object storage-op counters (`storageReads`/`storageWrites`/`storageByCallSite`) on the cell diagnostics for billing audits; canonical detail lives in `~/turbopanel/AGENTS.md` (Daemon Cell).
- **Run tests (Developer area)** — Developer → **Run tests…** (`run-tests`) opens a sub-view (`src/components/run-tests-view.tsx`) to pick a present checkout (`turbopaneld` / `turbopanel` / `ui` / `website` / `dev`) and a suite, then streams output via `runCaptured` inside the guest/VM (vendored `pnpm` or host/vendored `deno task`). Catalog + runner: `src/lib/run-repo-tests.ts`. Every run also writes a full transcript to `~/.local/console/test-runs/<repo>-<suite>-<timestamp>.log` and overwrites `~/.local/console/last-test-run.log` (`src/lib/test-run-log.ts`); the TUI prints those paths when finished. Esc cancels an in-flight run (AbortSignal → SIGTERM) or steps back; Enter re-runs after completion. Instance offers `test:do` / `test:coverage` / `test:hook`; website has no unit suite so typecheck/lint only.
- **Rebuild daemon and upgrade connected servers** — Developer → **Rebuild daemon and upgrade connected servers** (`rebuild-daemon-upgrade`) runs `deno task release:dev` in `~/turbopaneld` (compile + overlay `dist/channels.json` / `manifest.json` with relative artifact URLs) then `POST /api/developer/v1/daemon/update`. Connected **remote** servers download those artifacts from this instance (`TURBOPANEL_DL_BASE`); the co-located daemon is skipped (it runs from source). Overlay identity is `<git-sha>+<unix-seconds>` so each rebuild is newer than remotes that already baked the previous overlay of the same HEAD. The provisioner stays on screen until a keypress so compile/update output is readable. This must **not** run daemon bootstrap, the optional-services picker, or a local converge — set `daemonOperation` before switching to the bootstrap area so Ink does not mount ProvisionerPanel in the default `"daemon"` phase. **Sync source to attached checkouts** (`sync-dev-build`) remains the source-tarball path for daemons that still have a checkout.

## Testing

Local commands:

| Command | Purpose |
| ------- | ------- |
| `pnpm test` | Vitest once (`vitest run`) |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm test:coverage` | Vitest + LCOV (`coverage/lcov.info`) |
| `pnpm typecheck` | `tsc --noEmit` |

**Vitest convention:** place suites at `src/**/*.test.ts` / `src/**/*.test.tsx`. Use the `node` environment (Ink TUI, not a browser). Import `describe` / `it` / `expect` from `vitest` — do not use `node:test` + `node:assert/strict`. Assert shapes with `new TypeError()` per `typescript:S7786`.

**Shared test helpers:** this repo has no local shared test-helper module. Daemon test authors must use the shared doubles in `../turbopaneld/src/testing/` instead of hand-rolled ones (see that repo’s Testing section).

**Pre-commit** (`.githooks/pre-commit`): runs `scripts/scan-secrets.sh` only
(never skippable). Typecheck/tests are **temporarily disabled** in the hook
until the toolchain can run inside the Vagrant guest (host VirtFS checkouts
often lack a usable Node/pnpm tree). CI `verify.yml` still gates PRs.
`./console` idempotently sets `core.hooksPath=.githooks` via
`tp_ensure_git_hooks_path` in `scripts/lib/git-github-ssh.sh`.

**Gate matrix** (one policy with the daemon repo):

| Stage | dev | daemon | Rationale |
| ----- | --- | ------ | --------- |
| pre-commit | scan-secrets only (tests deferred) | scan-secrets only (tests deferred) | secret scan on commit; suites in CI / guest |
| PR → `trunk` | `verify.yml` | `verify.yml` | blocks merge |
| push `trunk` | `verify.yml` | `verify.yml`; `publish` job `needs: verify` | nothing compiles from failing code |
| promote → canary/rc/release | n/a | **artifact integrity only** (S3 sha256/size + CDN fetch) | no new code enters after publish |

**Coverage:** SonarCloud’s Sonar-way quality gate (CI scan in `.github/workflows/verify.yml` with `sonar.qualitygate.wait=true`) requires **≥ 80% coverage on new code**. Missing `SONAR_TOKEN` soft-fails / skips the Sonar steps (`continue-on-error`) so typecheck/tests still gate; wire the secret on the repo/org when ready. Sibling repos (`turbopanel`, `ui`, `website`) have no Actions verify — they use SonarCloud Automatic Analysis only.

## Ansible dev overlay

The **Ansible dev overlay** lives in `<dev checkout>/orchestration/` and overrides the daemon's production roles with dev-user parameters (the daemon still executes Ansible). Set `TURBOPANEL_MODE=development` during dev converge.

The **`dev-shell-path`** role (dev-only) always installs `/etc/profile.d/turbopanel-dev-deno.sh` (bash/login `sh`). When **zsh is installed** (`/usr/bin/zsh`), it also installs `/etc/zsh/zshenv.d/turbopanel-dev-deno` plus a guarded block in `/etc/zsh/zshenv` so **all zsh invocations** (including Oh My Zsh interactive shells — Debian does not source `/etc/zsh/zshrc.d`) prepend **`/opt/turbopanel/vendor/deno/current`** to `PATH`. Minimal Debian/Vagrant images ship bash only — zsh tasks are skipped rather than failing on a missing `/etc/zsh/zshenv` (a zsh-package conffile; do not create it on zsh-less hosts). That directory is the `deno-runtime` `current` symlink — version bumps only require updating the pin in the daemon role and `DENO_VERSION` in `scripts/lib/paths.sh` / `src/lib/paths.ts`, then re-converging. If a host later gains zsh, re-converge to wire the drop-ins.

### Development Caddyfile

Co-located hosts load **`orchestration/Caddyfile`** (not `~/turbopanel/Caddyfile`) when `turbopanel_dev_user` is set — wired by the daemon `instance-launch` role via `turbopanel_caddyfile`. That file owns:

- HTTPS `:8443` plus plaintext `:8880` (always on; no serve-time flag)
- Expo reverse_proxy when `TURBOPANEL_UI_MODE=dev` (with `expo-loading.html` for cold-start 502s; `flush_interval -1` so Fast Refresh `/hot` is unbuffered). Host edits on VirtioFS/9p need Metro poll watch in the UI repo (`scripts/metro-virtfs-poll-watch.cjs`) — inotify does not cross the share.
- Optional wrangler upstream when `TURBOPANEL_INSTANCE_RUNTIME=workers`
- `/downloads/daemon/*` (always — overlay catalog + artifacts; not gated on `TURBOPANEL_UI_MODE`) and the install script at **`/run.sh`** from the daemon checkout (`dist/` after Developer → **Rebuild daemon and upgrade connected servers** / `deno task release:dev`)

The instance repo's `Caddyfile` stays production-only (HTTPS + Deno socket + static UI). See **`../turbopanel/AGENTS.md`** (Caddy) and **`../turbopaneld/AGENTS.md`** (plaintext HTTP client gate).

## Shell libraries

- **`scripts/lib/privileges.sh`** — POSIX sudo re-exec helpers (`tp_ensure_privileges`), logging helpers, `tp_is_interactive()` (stdin TTY or readable/writable `/dev/tty`).
- **`scripts/lib/paths.sh`** — `/opt/turbopanel` path constants; pinned `NODE_VERSION` + vendored `NODE_BIN`/`PNPM_BIN` under `vendor/node/current/bin/`; pinned `DENO_VERSION` + `VENDORED_DENO_BIN` (`vendor/deno/current/deno`).
- **`scripts/lib/packages.sh`** — apt prerequisite checks: `tp_require_host_commands` (curl/tar/sha256sum).
- **`scripts/lib/runtime.sh`** — pinned **Node** install from the `nodejs.org` tarball into `/opt/turbopanel/vendor/node/<version>/` plus Corepack/pnpm (`tp_ensure_node_runtime`); `tp_export_deno_path` prepends vendored Deno for hooks/child shells.
- **`scripts/lib/dev-identity.sh`** — resolve dev user from process UID (`tp_resolve_dev_identity`).
- **`scripts/lib/dev-prerequisites.sh`** — curl/sudo/dev-user checks for `./console`. When sudo still requires a password, optionally prompts to install `/etc/sudoers.d/turbopanel-dev-nopasswd` (full `NOPASSWD` for the dev user on local dev hosts). Set `TURBOPANEL_DEV_SKIP_NOPASSWD_SUDO=1` to skip the prompt.
- **`scripts/lib/git-github-ssh.sh`** — git identity prompts, SSH key generation, GitHub verification (used by `./console` when needed).

## Key conventions

### TypeScript style (SonarQube)

- Prefer **`String#replaceAll()`** over **`String#replace()` with a global regex** when replacing every occurrence of a substring (`typescript:S7781`).
- Use **`String.raw`** for string literals that contain backslashes so escapes stay readable and correct (`typescript:S7780`). Example: POSIX shell single-quote escaping is `String.raw`'\''` plus `replaceAll("'", …)`, not `"\'\\''"` with `replace(/'/g, …)`.
- Import **`shellQuote`** from `src/lib/shell-quote.ts` for shell argument quoting — do not copy inline `shellQuote` helpers.
- Prefer **optional chaining** (`obj?.prop`) over `!obj || obj.prop` (`typescript:S6582`).
- Use **`new TypeError()`** (not `new Error()`) when asserting types/shapes in tests (`typescript:S7786`).
- Avoid **nested ternaries** — use `if`/`switch` or small helpers (`typescript:S3358`).
- Extract helpers when **cognitive complexity** exceeds 15 (`typescript:S3776`).
- Sort strings with **`.sort((a, b) => a.localeCompare(b))`** (`typescript:S2871`).
- Do not leave **`TODO`** in code — use `Future:` in a normal comment (`typescript:S1135`).
- Use **`RegExp.exec()`** instead of `String.match()` when extracting a single match (`typescript:S6594`).

### Ansible style (SonarQube)

- Prefer **`mode: "0640"`** / **`0750"`** over world-readable **`0644"`** / **`0755"`** for scripts and systemd units; set explicit **`owner`** / **`group`** (`ansible:S2612`).

- Default git branch is **`trunk`** everywhere.
- Shell scripts are **POSIX `sh`** — no bashisms. Sonar `shelldre:S7688` (`[[` vs `[`) and `shelldre:S7682` (explicit `return`) are ignored in `sonar-project.properties` / `.sonarcloud.properties` for that reason.
- Git clones use **SSH** (`git@github.com:turbopanel/...`), not HTTPS.
- **`console` owns the Node runtime** (for this repo) and starting the TUI. It does **not** install Deno or other platform runtimes.
- Contributors clone the six sibling repos on the host; Vagrant mounts them into the guest under `$HOME`.
- Developer identity (`TURBOPANEL_DEV_USER`, `TURBOPANEL_DEV_UID`, `TURBOPANEL_DEV_GID`) is resolved from the **process UID** via `getent passwd` (`tp_resolve_dev_identity()` in `scripts/lib/dev-identity.sh`). **`USER` / `LOGNAME` are never trusted.** Unresolved identities and `root` are rejected; the only root exception is a validated `SUDO_USER` passwd entry when the console runs under `sudo`.
- Node is pinned in `scripts/lib/paths.sh` (`NODE_VERSION` **`24.17.0`**), downloaded from `nodejs.org`, vendored to `/opt/turbopanel/vendor/node/<version>/` with a `current` symlink. pnpm is pinned solely by `packageManager` in `package.json` and provisioned via Corepack. `tp_corepack_env` sets `COREPACK_DEFAULT_TO_LATEST=0` and `COREPACK_ENABLE_AUTO_PIN=0` so `pnpm --version` after `corepack prepare --activate` stays on that pin (Corepack otherwise reports the newest npm release when `./console` is launched from `$HOME`, which produced `expected vX, got Y` on every bump). The version check runs from the checkout so Corepack reads that `package.json`.
- **`TURBOPANEL_MODE=development`** during dev converge. Source repos default under `$HOME` via `TURBOPANEL_DEV_ROOT` and per-repo `TURBOPANEL_<DIR>_REPO` overrides.
- Daemon bootstrap, systemd units, and Docker containers run as the **current dev user** — no `tp` / `tpctrl` / `tpcache` service accounts are created in dev.
- Purge/reset stops and removes the daemon systemd unit **`turbopaneld.service`**, dev FHS state under `/etc/turbopanel`, `/var/lib/turbopanel`, `/var/log/turbopanel`, `/run/turbopanel`, and runtimes under `/opt/turbopanel/vendor`.
- Do not commit secrets or environment-specific config.

## What agents must NOT do

- Do not reintroduce `deno.json`/`deno.lock` to this repo or use Deno to run the console — this repo is Node/pnpm/Vite.
- Do not add Deno installation or upgrade logic to `./console` or `scripts/lib/runtime.sh` — development Deno is resolved from host PATH when present and otherwise auto-vendored by the orchestration path (`ensureBootstrapDeno` / `ensureOrchestrationDenoBin`); production Deno remains platform-managed. Keep `./console` and `scripts/lib/runtime.sh` Node-only.
- Do not reintroduce a host-side clone/bootstrap installer or a Workers Static Assets host for contributor setup — use Vagrant + pre-cloned sibling repos; docs live at turbopanel.io.
- Do not add platform repo cloning to shell scripts — that belongs in the TUI when rebuilt.
- Do not hardcode developer UID/GID — always read from `tp_resolve_dev_identity()` / `tp_require_dev_identity()` in shell scripts.
- Do not reintroduce `pull.sh`.
- Platform repos live under **`$HOME`** (via `TURBOPANEL_DEV_ROOT` / `TURBOPANEL_<DIR>_REPO`) — do not clone into `/opt/turbopanel/platform`.
- Do not bump the pinned Node version without updating `scripts/lib/paths.sh` and docs. Bump pnpm by updating `packageManager` in `package.json` only.
- Do not commit directly to `trunk` — use a feature branch and open a PR.
- Do not update `AGENTS.md` to describe deleted multi-screen features as if they still exist — document the minimal `src/tui.tsx` flow until those features are reintroduced.

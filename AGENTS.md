# AGENTS.md

## What this repo is

`turbopanel-dev` is the **TurboPanel development console** — a minimal terminal UI built on [Ink](https://github.com/vadimdemedes/ink) 7, run on **Node** via **Vite (`vite-node`)**. Watch mode uses a custom Vite dev runner (`scripts/hot-reload.tsx`) that keeps the Ink process mounted and reloads changed `src/` modules. It is installed via a one-liner into `~/dev` (or `${TURBOPANEL_DEV_ROOT}/dev` when set).

**This repo runs on Node, not Deno.** In dev the console bootstraps
orchestration and runs the **daemon from the dev user's home checkout**
(`~/daemon`, resolved via `TURBOPANEL_DEV_ROOT` / `TURBOPANEL_DAEMON_REPO`) via Deno (`deno run main.ts`) — host Deno is
preferred, else the vendored runtime at
`/opt/turbopanel/vendor/deno/current/deno`. It never runs a
compiled daemon binary. Production installs (driven by `run.sh` + Ansible, **not**
this console) run the compiled **`/opt/turbopanel/bin/turbopaneld`** binary — with
a **`turbopaneld.js`** `deno run` fallback — as **`turbopaneld.service`** on the
FHS tree (`/etc/turbopanel`, `/var/lib/turbopanel`, `/var/log/turbopanel`,
`/run/turbopanel`; see the daemon repo's `AGENTS.md` → "Filesystem layout & path
model"). Deno is still installed for the **instance** stack (and mailer) via the
`deno-runtime` Ansible role during dev converge.

**Target host:** Debian 13 (Vagrant support planned).

**Bootstrap URL:** https://trbp.nl/develop.sh → `scripts/develop.sh` on the `trunk` branch. When piped (`curl … | sh`), `$0` is `sh` so local `scripts/lib/` is not on disk yet — the script downloads those libs from `raw.githubusercontent.com` (override with `TURBOPANEL_DEV_LIB_BASE`) before clone.

The current entrypoint is a minimal launcher only (full multi-screen console was removed during a rewrite).

## Filesystem layout

```
~/dev/                    # turbopanel-dev checkout (develop.sh clones here via TURBOPANEL_DEV_ROOT)
├── console               # ensure Node, pnpm install, launch the TUI via vite-node
├── orchestration/        # Ansible dev overlay (overrides daemon prod roles)
├── scripts/develop.sh    # clone/update + exec ./console
├── package.json          # Node project (pnpm, pinned via packageManager); ink + react + vite
├── src/tui.tsx           # Ink entrypoint
└── …

~/daemon/                 # TURBOPANEL_DAEMON_REPO (default: $TURBOPANEL_DEV_ROOT/daemon)
~/instance/               # TURBOPANEL_INSTANCE_REPO
~/ui/                     # TURBOPANEL_UI_REPO
~/website/                # TURBOPANEL_WEBSITE_REPO

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

Node is a pinned `nodejs.org` tarball vendored under `/opt/turbopanel/vendor/node/<version>/` with a `current` symlink (same layout as deno/caddy). pnpm is provisioned via Corepack and pinned by the `packageManager` field in `package.json`. Deno is **host-provided in development** (preferred) or bootstrap-installed to `/opt/turbopanel/vendor/deno/current/deno` when host Deno is absent; the dev console always runs the daemon and orchestration **from the source checkout** via Deno. Production daemon installs use the compiled `/opt/turbopanel/bin/turbopaneld` binary (with a `turbopaneld.js` `deno run` fallback), driven by `run.sh` + Ansible — never by this console.

## Fresh-clone → working dev

1. Clone the five repos into `$HOME` (`~/dev`, `~/daemon`, `~/instance`, `~/ui`, `~/website`).
2. From `~/dev`, run `./console` → prereqs, pinned Node, `pnpm install`, TUI launch (exports `TURBOPANEL_MODE=development`, `TURBOPANEL_DEV_ROOT`, `TURBOPANEL_<DIR>_REPO`).
3. **Start dev stack** → daemon bootstraps as the dev user, writes `/etc/turbopanel/daemon.env`, runs the `dev/orchestration` overlay: runtimes into `/opt/turbopanel/vendor`, systemd units + Docker (postgres/redis/rabbitmq/mailpit) as the dev user, mutable data under FHS trees dev-user-owned. No `turbopanel` / `turbopaneli` / `turbopanelc` accounts created.
4. Open `https://localhost:8443` (or dev `http://localhost:8880`); edit source in place under `$HOME`.

## Entry points

| Script | Purpose |
|--------|---------|
| `curl -fsSL https://trbp.nl/develop.sh \| sh` | Clone/update `~/dev` via SSH, then launch the TUI. |
| `sh scripts/develop.sh` | Same when run from inside the repo to update the checkout. |
| `./console` | Ensure pinned Node (sudo on first run), `pnpm install`, launch `src/tui.tsx` via `vite-node`. |
| `./console --watch` | Same, but use `scripts/hot-reload.tsx` for live reload on `src/` changes. |
| `pnpm dev` | Run `src/tui.tsx` directly via `vite-node` (requires Node on PATH). |
| `pnpm dev:watch` | Run `scripts/hot-reload.tsx`, which keeps Ink mounted and rerenders on `src/` changes. |

**Typical flow:**

```bash
curl -fsSL https://trbp.nl/develop.sh | sh
```

(`develop.sh` clones/updates the checkout and `exec`s `./console`.)

## Responsibilities

- **`scripts/develop.sh`** — clones/updates **only** `turbopanel-dev` via `git@github.com:turbopanel/turbopanel-dev.git`. Requires **`curl`**, **`sudo`**, and a **sudo-capable development user** before it runs (`scripts/lib/dev-prerequisites.sh`). On first run, prompts for git `user.name` and `user.email`, generates `~/.ssh/id_ed25519` if missing, configures SSH commit signing, and verifies GitHub SSH before cloning. May use sudo for `git` / `openssh-client` apt installs. Uses `tp_is_interactive()` so `curl | sh` works when a controlling terminal is available (`/dev/tty`).
- **`console`** — runs the prerequisite check, ensures pinned **Node** (`/opt/turbopanel/vendor/node/current/bin/node`, runs this repo) is installed, enables Corepack/pnpm, runs `pnpm install`, and launches the Ink TUI via `vite-node`. Add `--watch` to use `scripts/hot-reload.tsx`, which keeps the Ink process alive and rerenders when imported `src/` modules change. When stdin/stdout/stderr are not TTYs (e.g. after `exec` from a piped bootstrap), reattaches stdio to `/dev/tty` when `tp_is_interactive()` succeeds. Does **not** install Deno via `./console` itself (Deno bootstrap is via `ensureBootstrapDeno` during daemon install).
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
- **`src/lib/paths.ts`** — `TURBOPANEL_TRUNK_BRANCH` (`trunk`) is the dev shim for git checkouts and `TURBOPANEL_TRUNK_BRANCH` in `/etc/turbopanel/daemon.env`; release/binary installs omit it. Path helpers: `resolveDevRoot()`, `platformRepoPath()`, `TURBOPANEL_DEV_ROOT`, `TURBOPANEL_<DIR>_REPO` env overrides. Mutable data: `CONFIG_DIR=/etc/turbopanel`, `LOG_DIR=/var/log/turbopanel`, `RUNTIMES_DIR=/opt/turbopanel/vendor`. Daemon: `DAEMON_ENV_PATH=/etc/turbopanel/daemon.env`, `DAEMON_LOG_PATH`/`DAEMON_ERR_LOG_PATH`=`/var/log/turbopanel/daemon/*`. Console logs: `consoleLogDir()` → `~/.local/console`. `DENO_VERSION` (**`2.9.1`**) is the console's bootstrap fallback + status label and **must** match `deno_version` in the daemon's `deno-runtime` role (pinned by the daemon's `src/orchestration/paths.test.ts`). The daemon systemd unit name lives here too: `DAEMON_SYSTEMD_UNIT` = **`turbopaneld`** (matches the daemon's `install-daemon-systemd.sh`), with `LEGACY_DAEMON_SYSTEMD_UNIT` = `turbopanel-daemon` cleaned up on purge/reset for pre-rename hosts.
- **`src/lib/daemon-exec.ts`** — always resolves a **Deno** invocation of the source-checkout scripts (`scripts/bootstrap-orchestration.ts`, `scripts/run-orchestration-action.ts`): host Deno if on PATH, else `/opt/turbopanel/vendor/deno/current/deno`. It never runs `/opt/turbopanel/bin/turbopaneld`; that compiled entrypoint (and its `turbopaneld.js` fallback) exists only on managed/production installs, which the console does not drive.

## Ansible dev overlay

The **Ansible dev overlay** lives in `<daemon checkout>/dev/orchestration/` and overrides the daemon's production roles with dev-user parameters (the daemon still executes Ansible). Set `TURBOPANEL_MODE=development` during dev converge.

## Shell libraries

- **`scripts/lib/privileges.sh`** — POSIX sudo re-exec helpers (`tp_ensure_privileges`), logging helpers, `tp_is_interactive()` (stdin TTY or readable/writable `/dev/tty`).
- **`scripts/lib/paths.sh`** — `/opt/turbopanel` path constants; pinned `NODE_VERSION` + vendored `NODE_BIN`/`PNPM_BIN` under `vendor/node/current/bin/`.
- **`scripts/lib/packages.sh`** — apt prerequisite checks: `tp_ensure_node_prerequisites` (curl/tar/xz-utils/sha256sum).
- **`scripts/lib/runtime.sh`** — pinned **Node** install from the `nodejs.org` tarball into `/opt/turbopanel/vendor/node/<version>/` plus Corepack/pnpm (`tp_ensure_node_runtime`).
- **`scripts/lib/dev-identity.sh`** — resolve dev user from process UID (`tp_resolve_dev_identity`).
- **`scripts/lib/dev-prerequisites.sh`** — curl/sudo/dev-user checks shared by `develop.sh` and `./console`. When sudo still requires a password, optionally prompts to install `/etc/sudoers.d/turbopanel-dev-nopasswd` (full `NOPASSWD` for the dev user on local dev hosts). Set `TURBOPANEL_DEV_SKIP_NOPASSWD_SUDO=1` to skip the prompt.
- **`scripts/lib/git-github-ssh.sh`** — git identity prompts, SSH key generation, GitHub verification (used by `develop.sh`).

## Key conventions

- Default git branch is **`trunk`** everywhere.
- Shell scripts are **POSIX `sh`** — no bashisms.
- Git clones use **SSH** (`git@github.com:turbopanel/...`), not HTTPS.
- **`scripts/develop.sh` only installs this repo** — no runtime, no platform repos.
- **`console` owns the Node runtime** (for this repo) and starting the TUI. It does **not** install Deno or other platform runtimes.
- **`develop.sh` clones to `~/dev`** (or `${TURBOPANEL_DEV_ROOT}/dev` when set), alongside sibling repos under the same dev root.
- Developer identity (`TURBOPANEL_DEV_USER`, `TURBOPANEL_DEV_UID`, `TURBOPANEL_DEV_GID`) is resolved from the **process UID** via `getent passwd` (`tp_resolve_dev_identity()` in `scripts/lib/dev-identity.sh`). **`USER` / `LOGNAME` are never trusted.** Unresolved identities and `root` are rejected; the only root exception is a validated `SUDO_USER` passwd entry when the console runs under `sudo`.
- Node is pinned in `scripts/lib/paths.sh` (`NODE_VERSION` **`24.17.0`**), downloaded from `nodejs.org`, vendored to `/opt/turbopanel/vendor/node/<version>/` with a `current` symlink. pnpm is pinned solely by `packageManager` in `package.json` and provisioned via Corepack.
- **`TURBOPANEL_MODE=development`** during dev converge. Source repos default under `$HOME` via `TURBOPANEL_DEV_ROOT` and per-repo `TURBOPANEL_<DIR>_REPO` overrides.
- Daemon bootstrap, systemd units, and Docker containers run as the **current dev user** — no `turbopanel` / `turbopaneli` / `turbopanelc` service accounts are created in dev.
- Purge/reset stops and removes the daemon systemd unit **`turbopaneld.service`** (and the legacy `turbopanel-daemon.service` for pre-rename hosts), dev FHS state under `/etc/turbopanel`, `/var/lib/turbopanel`, `/var/log/turbopanel`, `/run/turbopanel`, and runtimes under `/opt/turbopanel/vendor`.
- Do not commit secrets or environment-specific config.

## What agents must NOT do

- Do not reintroduce `deno.json`/`deno.lock` to this repo or use Deno to run the console — this repo is Node/pnpm/Vite.
- Do not add Deno installation or upgrade logic to `./console` or `scripts/lib/runtime.sh` — Deno is host-provided in dev and platform-managed in production.
- Do not add runtime installs, dependency install, or sudo to `scripts/develop.sh` — that belongs in `./console`.
- Do not add platform repo cloning to shell scripts — that belongs in the TUI when rebuilt.
- Do not hardcode developer UID/GID — always read from `tp_resolve_dev_identity()` / `tp_require_dev_identity()` in shell scripts.
- Do not reintroduce `pull.sh`.
- Platform repos live under **`$HOME`** (via `TURBOPANEL_DEV_ROOT` / `TURBOPANEL_<DIR>_REPO`) — do not clone into `/opt/turbopanel/platform`.
- Do not bump the pinned Node version without updating `scripts/lib/paths.sh` and docs. Bump pnpm by updating `packageManager` in `package.json` only.
- Do not commit directly to `trunk` — use a feature branch and open a PR.
- Do not update `AGENTS.md` to describe deleted multi-screen features as if they still exist — document the minimal `src/tui.tsx` flow until those features are reintroduced.

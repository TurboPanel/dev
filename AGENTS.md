# AGENTS.md

## What this repo is

`turbopanel-dev` is the **TurboPanel development console** — a minimal terminal UI built on [Ink](https://github.com/vadimdemedes/ink) 7, run on **Node** via **Vite (`vite-node`)**. Watch mode uses a custom Vite dev runner (`scripts/hot-reload.tsx`) that keeps the Ink process mounted and reloads changed `src/` modules. It is installed via a one-liner into `./turbopanel-dev` relative to the user's current directory.

**This repo runs on Node, not Deno.** Deno on the **host** is optional for dev
when a compiled bootstrap binary or host Deno is available for orchestration
bootstrap and binary builds; the console does not install or manage it. The
**daemon** runs as compiled `dist/turbopaneld`. Deno is still installed for the
**instance** stack (and mailer) via the `deno-runtime` Ansible role during dev
converge.

**Target host:** Debian 13 (Vagrant support planned).

**Bootstrap URL:** https://trbp.nl/develop.sh → `scripts/develop.sh` on the `trunk` branch. When piped (`curl … | sh`), `$0` is `sh` so local `scripts/lib/` is not on disk yet — the script downloads those libs from `raw.githubusercontent.com` (override with `TURBOPANEL_DEV_LIB_BASE`) before clone.

The previous multi-screen console (Status / Instance / Developer areas, stack actions, Ansible task list) was archived under `temp/legacy-src/` during a rewrite. The current entrypoint is a minimal launcher only.

## Filesystem layout

```
~/…/turbopanel-dev/       # ./turbopanel-dev from scripts/develop.sh (user's cwd)
├── console               # ensure Node, pnpm install, launch the TUI via vite-node
├── scripts/develop.sh    # clone/update + exec ./console
├── package.json          # Node project (pnpm, pinned via packageManager); ink + react + vite
├── pnpm-lock.yaml
├── vite.config.ts        # vite-node config: React transform + @turbopanel/components alias
├── tsconfig.json         # TS/JSX config (react-jsx)
├── src/tui.tsx           # Ink entrypoint
├── src/components/       # MenuBar, StatusBar, MainPanel, AreaTabs
└── temp/legacy-src/      # archived pre-refactor console (reference only)
/usr/local/bin/node        # pinned Node (installed by ./console) — runs this repo
/usr/local/bin/pnpm        # pnpm shim (Corepack)
/opt/turbopanel/
├── platform/             # daemon and other platform repos (installed by daemon via Ansible)
└── runtimes/             # uv/python/ansible (orchestration bootstrap); deno for instance stack
```

Node is a pinned `nodejs.org` tarball installed into `/usr/local`. pnpm is provisioned via Corepack and pinned by the `packageManager` field in `package.json`. Deno is **host-provided in development** when compiling daemon release artifacts or when `dist/turbopaneld` is absent; production daemon installs use the compiled `turbopaneld` binary only.

## Entry points

| Script | Purpose |
|--------|---------|
| `curl -fsSL https://trbp.nl/develop.sh \| sh` | Clone/update `./turbopanel-dev` via SSH, then launch the TUI. |
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
- **`console`** — runs the prerequisite check, ensures pinned **Node** (`/usr/local/bin/node`, runs this repo) is installed, enables Corepack/pnpm, runs `pnpm install`, and launches the Ink TUI via `vite-node`. Add `--watch` to use `scripts/hot-reload.tsx`, which keeps the Ink process alive and rerenders when imported `src/` modules change. When stdin/stdout/stderr are not TTYs (e.g. after `exec` from a piped bootstrap), reattaches stdio to `/dev/tty` when `tp_is_interactive()` succeeds. Does **not** install Deno.
- **`src/tui.tsx`** — minimal Ink app: full-height shell with a one-row `MenuBar`, a bordered `MainPanel`, and a one-row `StatusBar`. `← →` switches areas; Ctrl-C exits. Uses `alternateScreen`. No stack orchestration or platform install yet — restore from `temp/legacy-src/` as features return.

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
- **`src/lib/paths.ts`** — `TURBOPANEL_TRUNK_BRANCH` (`trunk`) is the co-located dev shim for git checkouts and `TURBOPANEL_TRUNK_BRANCH` in the daemon `.env`; release/binary installs omit it.
- **`src/lib/daemon-exec.ts`** — resolves bootstrap invocation: `dist/turbopaneld bootstrap-orchestration` when present, otherwise host Deno (`command -v deno`) for dev checkout bootstrap and binary builds.

## Shell libraries

- **`scripts/lib/privileges.sh`** — POSIX sudo re-exec helpers (`tp_ensure_privileges`), logging helpers, `tp_is_interactive()` (stdin TTY or readable/writable `/dev/tty`).
- **`scripts/lib/paths.sh`** — `/opt/turbopanel` path constants; pinned `NODE_VERSION` + `NODE_PREFIX`/`NODE_BIN`, `PNPM_BIN`.
- **`scripts/lib/packages.sh`** — apt prerequisite checks: `tp_ensure_node_prerequisites` (curl/tar/xz-utils/sha256sum).
- **`scripts/lib/runtime.sh`** — pinned **Node** install from the `nodejs.org` tarball into `/usr/local` plus Corepack/pnpm (`tp_ensure_node_runtime`).
- **`scripts/lib/dev-identity.sh`** — resolve dev user from process UID (`tp_resolve_dev_identity`).
- **`scripts/lib/dev-prerequisites.sh`** — curl/sudo/dev-user checks shared by `develop.sh` and `./console`. When sudo still requires a password, optionally prompts to install `/etc/sudoers.d/turbopanel-dev-nopasswd` (full `NOPASSWD` for the dev user on local dev hosts). Set `TURBOPANEL_DEV_SKIP_NOPASSWD_SUDO=1` to skip the prompt.
- **`scripts/lib/git-github-ssh.sh`** — git identity prompts, SSH key generation, GitHub verification (used by `develop.sh`).

## Key conventions

- Default git branch is **`trunk`** everywhere.
- Shell scripts are **POSIX `sh`** — no bashisms.
- Git clones use **SSH** (`git@github.com:turbopanel/...`), not HTTPS.
- **`scripts/develop.sh` only installs this repo** — no runtime, no platform repos.
- **`console` owns the Node runtime** (for this repo) and starting the TUI. It does **not** install Deno or other platform runtimes.
- **`turbopanel-dev` installs to `./turbopanel-dev`** in the user's cwd.
- Developer identity (`TURBOPANEL_DEV_USER`, `TURBOPANEL_DEV_UID`, `TURBOPANEL_DEV_GID`) is resolved from the **process UID** via `getent passwd` (`tp_resolve_dev_identity()` in `scripts/lib/dev-identity.sh`). **`USER` / `LOGNAME` are never trusted.** Unresolved identities and `root` are rejected; the only root exception is a validated `SUDO_USER` passwd entry when the console runs under `sudo`.
- Node is pinned in `scripts/lib/paths.sh` (`NODE_VERSION`), downloaded from `nodejs.org`, installed to `/usr/local` (override prefix with `NODE_PREFIX=`). pnpm is pinned solely by `packageManager` in `package.json` and provisioned via Corepack.
- Daemon bootstrap runs as **`turbopanel`** when that user exists (only falling back to root for the first bootstrap phase before Ansible creates the user). Purge removes the daemon checkout, systemd unit, shared runtime state under `/opt/turbopanel/runtimes`, and turbopanel-owned dotdirs (`.cache`, `.ansible`, `.local`).
- Do not commit secrets or environment-specific config.

## Legacy archive

The pre-refactor console lives under `temp/legacy-src/` (Ink screens, hooks, lib, orchestration glue) and `temp/legacy-scripts/` (patches, orchestration runner). See `temp/README.md`. Do not treat archived paths as the live layout.

## What agents must NOT do

- Do not reintroduce `deno.json`/`deno.lock` to this repo or use Deno to run the console — this repo is Node/pnpm/Vite.
- Do not add Deno installation or upgrade logic to `./console` or `scripts/lib/runtime.sh` — Deno is host-provided in dev and platform-managed in production.
- Do not add runtime installs, dependency install, or sudo to `scripts/develop.sh` — that belongs in `./console`.
- Do not add platform repo cloning to shell scripts — that belongs in the TUI when rebuilt.
- Do not hardcode developer UID/GID — always read from `tp_resolve_dev_identity()` / `tp_require_dev_identity()` in shell scripts.
- Do not reintroduce `pull.sh`.
- Do not clone `turbopanel-dev` into `/opt/turbopanel/platform`.
- Do not bump the pinned Node version without updating `scripts/lib/paths.sh` and docs. Bump pnpm by updating `packageManager` in `package.json` only.
- Do not commit directly to `trunk` — use a feature branch and open a PR.
- Do not update `AGENTS.md` to describe deleted multi-screen features as if they still exist — document the minimal `src/tui.tsx` flow until those features are reintroduced.

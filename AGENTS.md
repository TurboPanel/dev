# AGENTS.md

## What this repo is

`turbopanel-dev` is the **TurboPanel development console** — a Deno CLI with a minimal terminal UI built on [Ink](https://github.com/vadimdemedes/ink) 7 (`npm:ink`). It is installed via a one-liner into `./turbopanel-dev` relative to the user's current directory.

**Target host:** Debian 13 (Vagrant support planned).

**Bootstrap URL:** https://develop.trbp.nl → `scripts/develop.sh` on the `trunk` branch. When piped (`curl … | sh`), `$0` is `sh` so local `scripts/lib/` is not on disk yet — the script downloads those libs from `raw.githubusercontent.com` (override with `TURBOPANEL_DEV_LIB_BASE`) before clone.

The previous multi-screen console (Status / Instance / Developer areas, stack actions, Ansible task list) was archived under `temp/legacy-src/` during a rewrite. The current entrypoint is a minimal launcher only.

## Filesystem layout

```
~/…/turbopanel-dev/       # ./turbopanel-dev from scripts/develop.sh (user's cwd)
├── console               # Deno install + launch TUI
├── scripts/develop.sh    # clone/update + exec ./console
├── deno.json
├── src/tui.tsx           # Ink entrypoint (minimal success screen)
└── temp/legacy-src/      # archived pre-refactor console (reference only)
/usr/local/bin/deno        # pinned console Deno (installed by ./console)
/opt/turbopanel/
├── platform/             # daemon and other platform repos (installed by daemon via Ansible)
└── runtimes/             # uv/python/ansible (daemon); not console Deno
```

Console Deno is a pinned GitHub release installed to `/usr/local/bin/deno`.

## Entry points

| Script | Purpose |
|--------|---------|
| `curl -fsSL https://develop.trbp.nl \| sh` | Clone/update `./turbopanel-dev` via SSH, then launch the TUI. |
| `sh scripts/develop.sh` | Same when run from inside the repo to update the checkout. |
| `./console` | Install pinned Deno to `/usr/local/bin` if missing (sudo), cache deps, launch `src/tui.tsx`. |
| `deno task dev` | Run `src/tui.tsx` directly (requires Deno on PATH). |

**Typical flow:**

```bash
curl -fsSL https://develop.trbp.nl | sh
```

(`develop.sh` clones/updates the checkout and `exec`s `./console`.)

## Responsibilities

- **`scripts/develop.sh`** — clones/updates **only** `turbopanel-dev` via `git@github.com:turbopanel/turbopanel-dev.git`. Requires **`curl`**, **`sudo`**, and a **sudo-capable development user** before it runs (`scripts/lib/dev-prerequisites.sh`). On first run, prompts for git `user.name` and `user.email`, generates `~/.ssh/id_ed25519` if missing, configures SSH commit signing, and verifies GitHub SSH before cloning. May use sudo for `git` / `openssh-client` apt installs. Uses `tp_is_interactive()` so `curl | sh` works when a controlling terminal is available (`/dev/tty`).
- **`console`** — runs the same prerequisite check, ensures the pinned Deno release is installed at `/usr/local/bin/deno` (sudo on first run), caches dependencies for `src/tui.tsx`, starts the Ink TUI. When stdin/stdout/stderr are not TTYs (e.g. after `exec` from a piped bootstrap), reattaches stdio to `/dev/tty` when `tp_is_interactive()` succeeds.
- **`src/tui.tsx`** — minimal Ink app: confirms install/launch succeeded and tells the user to press Ctrl-C to exit. Uses `alternateScreen`. No stack orchestration, area navigation, or platform install yet — restore from `temp/legacy-src/` as features return.

## Deno app

```
src/
└── tui.tsx               # entry; render + minimal App component
```

`deno.json` exports `./src/tui.tsx` and defines tasks `dev`, `console:watch`, and `cache` against that file.

Keep the CLI **simple**. Platform repo install, service monitoring, and stack actions belong in the Ink app when rebuilt — not new shell scripts.

## Shell libraries

- **`scripts/lib/privileges.sh`** — POSIX sudo re-exec helpers (`tp_ensure_privileges`), logging helpers, `tp_is_interactive()` (stdin TTY or readable/writable `/dev/tty`).
- **`scripts/lib/paths.sh`** — `/opt/turbopanel` path constants, pinned Deno version.
- **`scripts/lib/runtime.sh`** — pinned Deno install to `/usr/local/bin` (`tp_ensure_deno_runtime`).
- **`scripts/lib/dev-identity.sh`** — resolve dev user from process UID (`tp_resolve_dev_identity`).
- **`scripts/lib/dev-prerequisites.sh`** — curl/sudo/dev-user checks shared by `develop.sh` and `./console`. When sudo still requires a password, optionally prompts to install `/etc/sudoers.d/turbopanel-dev-nopasswd` (full `NOPASSWD` for the dev user on local dev hosts). Set `TURBOPANEL_DEV_SKIP_NOPASSWD_SUDO=1` to skip the prompt.
- **`scripts/lib/git-github-ssh.sh`** — git identity prompts, SSH key generation, GitHub verification (used by `develop.sh`).

## Key conventions

- Default git branch is **`trunk`** everywhere.
- Shell scripts are **POSIX `sh`** — no bashisms.
- Git clones use **SSH** (`git@github.com:turbopanel/...`), not HTTPS.
- **`scripts/develop.sh` only installs this repo** — no runtime, no platform repos.
- **`console` owns the Deno runtime** and starting the TUI.
- **`turbopanel-dev` installs to `./turbopanel-dev`** in the user's cwd.
- Developer identity (`TURBOPANEL_DEV_USER`, `TURBOPANEL_DEV_UID`, `TURBOPANEL_DEV_GID`) is resolved from the **process UID** via `getent passwd` (`tp_resolve_dev_identity()` in `scripts/lib/dev-identity.sh`). **`USER` / `LOGNAME` are never trusted.** Unresolved identities and `root` are rejected; the only root exception is a validated `SUDO_USER` passwd entry when the console runs under `sudo`.
- Console Deno is pinned in `scripts/lib/paths.sh`, downloaded from GitHub releases, and installed to `/usr/local/bin/deno` (override with `DENO_BIN=`). `./scripts/deno.sh` invokes that binary.
- Do not commit secrets or environment-specific config.

## Legacy archive

The pre-refactor console lives under `temp/legacy-src/` (Ink screens, hooks, lib, orchestration glue) and `temp/legacy-scripts/` (patches, orchestration runner). See `temp/README.md`. Do not treat archived paths as the live layout.

## What agents must NOT do

- Do not add Deno install, dependency caching, or sudo to `scripts/develop.sh`.
- Do not add platform repo cloning to shell scripts — that belongs in the TUI when rebuilt.
- Do not hardcode developer UID/GID — always read from `tp_resolve_dev_identity()` / `tp_require_dev_identity()` in shell scripts (or the archived `resolveDevIdentity()` in `temp/legacy-src/lib/paths.ts` when porting TS back).
- Do not reintroduce `pull.sh`.
- Do not clone `turbopanel-dev` into `/opt/turbopanel/platform`.
- Do not bump the pinned Deno version without updating `scripts/lib/paths.sh` and docs. The next `./console` run installs the new release to `/usr/local/bin/deno` and removes a legacy `/opt/turbopanel/runtimes/deno` tree when present.
- Do not commit directly to `trunk` — use a feature branch and open a PR.
- Do not update `AGENTS.md` to describe deleted multi-screen features as if they still exist — document the minimal `src/tui.tsx` flow until those features are reintroduced.

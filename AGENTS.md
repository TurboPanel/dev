# AGENTS.md

## What this repo is

The **dev** repository ([turbopanel/dev](https://github.com/turbopanel/dev)) is the **TurboPanel Development Environment** — contributor tooling only, not production or self-hosted install. It is a minimal terminal UI built on [Ink](https://github.com/vadimdemedes/ink) 7, run on **Node** via **Vite (`vite-node`)**. Watch mode uses a custom Vite dev runner (`scripts/hot-reload.tsx`) that keeps the Ink process mounted and reloads changed `src/` modules. It is installed via a one-liner into `~/dev` (or `${TURBOPANEL_DEV_ROOT}/dev` when set).

**License:** AGPL-3.0-only. **Maturity:** **Public beta**. README is product-facing; AGENTS.md is maintainer-facing.

**This repo runs on Node, not Deno.** In dev the console bootstraps
orchestration and runs the **daemon from the dev user's home checkout**
(`~/daemon`, resolved via `TURBOPANEL_DEV_ROOT` / `TURBOPANEL_DAEMON_REPO`) via Deno (`deno run main.ts`) — host Deno is
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

**Target host:** Debian 13 (Vagrant support planned).

**Bootstrap URL:** `dev.turbopanel.sh` (advertised one-liner; root serves `scripts/develop.sh` from the `trunk` branch of [turbopanel/dev](https://github.com/turbopanel/dev)). When piped (`curl … | sh`), `$0` is `sh` so local `scripts/lib/` is not on disk yet — the script downloads those libs from `raw.githubusercontent.com/turbopanel/dev` (override with `TURBOPANEL_DEV_LIB_BASE`) before clone.

The current entrypoint is a minimal launcher only (full multi-screen console was removed during a rewrite).

## Installer script hosting (`workers/dev-turbopanel-sh/`)

**https://dev.turbopanel.sh** is the canonical **assets-only** Workers Static
Assets host for the dev bootstrap script — **no Worker script**, so bootstrap
traffic can never generate Worker invocation billing. `_headers` sets the shellscript
content type + `no-store` on `/`. Deploy tooling lives in the isolated
`workers/dev-turbopanel-sh/` package (Node + wrangler only — not part of the Vite/
`tsconfig` graph). Manual deploy: `pnpm install` then `pnpm run deploy` from that
directory; the stage step copies `scripts/develop.sh` to `public/bootstrap` (plus committed
`assets/_headers` and `assets/_redirects`) into gitignored `public/` at deploy
time so the script stays a single source of truth. Canonical advertised host is
**dev.turbopanel.sh** (bare domain in curl one-liners).

## Filesystem layout

```
~/dev/                    # turbopanel/dev checkout (develop.sh clones here via TURBOPANEL_DEV_ROOT)
├── console               # ensure Node, pnpm install, launch the TUI via vite-node
├── orchestration/        # Ansible dev overlay + development Caddyfile
│   ├── Caddyfile         # co-located control-plane proxy (Expo, :8880, wrangler)
│   └── expo-loading.html # Expo cold-start page served by the development Caddyfile
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

Node is a pinned `nodejs.org` tarball vendored under `/opt/turbopanel/vendor/node/<version>/` with a `current` symlink (same layout as deno/caddy). pnpm is provisioned via Corepack and pinned by the `packageManager` field in `package.json`. Deno is **host-provided in development** (preferred) or bootstrap-installed to `/opt/turbopanel/vendor/deno/current/deno` when host Deno is absent; the dev console always runs the daemon and orchestration **from the source checkout** via Deno. Production daemon installs use native `/opt/turbopanel/bin/turbopaneld` or, when that binary cannot execute on the host, `turbopaneld.js` via vendored Deno — driven by `run.sh` + Ansible, never by this console.

## Fresh-clone → working dev

1. Clone the five repos into `$HOME` (`~/dev`, `~/daemon`, `~/instance`, `~/ui`, `~/website`).
2. From `~/dev`, run `./console` → prereqs, pinned Node, `pnpm install`, TUI launch (exports `TURBOPANEL_MODE=development`, `TURBOPANEL_DEV_ROOT`, `TURBOPANEL_<DIR>_REPO`).
3. **Converge / re-converge** → daemon bootstraps as the dev user, writes `/etc/turbopanel/daemon.env`, runs the `dev/orchestration` overlay: runtimes into `/opt/turbopanel/vendor`, systemd units + Docker (postgres/redis/rabbitmq/mailpit) as the dev user, mutable data under FHS trees dev-user-owned. No `tp` / `tpctrl` / `tpcache` accounts created.
4. Open `https://localhost:8443` (or dev `http://localhost:8880`); edit source in place under `$HOME`.

## Entry points

| Script | Purpose |
|--------|---------|
| `curl -fsSL dev.turbopanel.sh \| sh` | Clone/update `~/dev` via SSH, then launch the TUI. |
| `sh scripts/develop.sh` | Same when run from inside the repo to update the checkout. |
| `./console` | Ensure pinned Node (sudo on first run), `pnpm install`, launch `src/tui.tsx` via `vite-node`. |
| `./console --watch` | Same, but use `scripts/hot-reload.tsx` for live reload on `src/` changes. |
| `pnpm dev` | Run `src/tui.tsx` directly via `vite-node` (requires Node on PATH). |
| `pnpm dev:watch` | Run `scripts/hot-reload.tsx`, which keeps Ink mounted and rerenders on `src/` changes. |
| `./scripts/sync.sh` | Push `instance/src/lib/db/schema.ts` → live Postgres (drizzle-kit push; Deno dev convenience). |
| `./scripts/introspect.sh` | Pull live Postgres → `instance/src/lib/db/schema.ts` (drizzle-kit introspect). |

**Typical flow:**

```bash
curl -fsSL dev.turbopanel.sh | sh
```

(`develop.sh` clones/updates the checkout and `exec`s `./console`.)

## Responsibilities

- **`scripts/develop.sh`** — clones/updates **only** [turbopanel/dev](https://github.com/turbopanel/dev) via `git@github.com:turbopanel/dev.git` into `~/dev`. Requires **`curl`**, **`sudo`**, and a **sudo-capable development user** before it runs (`scripts/lib/dev-prerequisites.sh`). On first run, prompts for git `user.name` and `user.email`, generates `~/.ssh/id_ed25519` if missing, configures SSH commit signing, and verifies GitHub SSH before cloning. May use sudo for `git` / `openssh-client` apt installs. Uses `tp_is_interactive()` so `curl | sh` works when a controlling terminal is available (`/dev/tty`).
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
- **`src/lib/paths.ts`** — `TURBOPANEL_TRUNK_BRANCH` (`trunk`) is the dev shim for git checkouts and `TURBOPANEL_TRUNK_BRANCH` in `/etc/turbopanel/daemon.env`; release/binary installs omit it. Path helpers: `resolveDevRoot()`, `platformRepoPath()`, `TURBOPANEL_DEV_ROOT`, `TURBOPANEL_<DIR>_REPO` env overrides. Mutable data: `CONFIG_DIR=/etc/turbopanel`, `LOG_DIR=/var/log/turbopanel`, `RUNTIMES_DIR=/opt/turbopanel/vendor`. Daemon: `DAEMON_ENV_PATH=/etc/turbopanel/daemon.env`, `DAEMON_LOG_PATH`/`DAEMON_ERR_LOG_PATH`=`/var/log/turbopanel/daemon.log` + `daemon.err.log`. Console logs: `consoleLogDir()` → `~/.local/console`. `DENO_VERSION` (**`2.9.4`**) is the console's bootstrap fallback + status label and **must** match `deno_version` in the daemon's `deno-runtime` role (pinned by the daemon's `src/orchestration/paths.test.ts`). The daemon systemd unit name is **`turbopaneld`** (`DAEMON_SYSTEMD_UNIT`), matching the daemon's `install-daemon-systemd.sh` and managed production installs.
- **`src/lib/daemon-exec.ts`** — always resolves a **Deno** invocation of the source-checkout scripts (`scripts/bootstrap-orchestration.ts`, `scripts/run-orchestration-action.ts`): host Deno if on PATH, else `/opt/turbopanel/vendor/deno/current/deno`. It never runs `/opt/turbopanel/bin/turbopaneld` or `turbopaneld.js`; those managed/production ExecStart modes are outside this console.
- **Cell trace (Developer area)** — the Developer menu (`src/lib/daemon-actions.ts` → `toggle-cell-trace` / `view-cell-trace` actions, dispatched in `src/hooks/use-console-app.ts`) lets you enable/disable verbose cell tracing and view it. The toggle (`src/lib/instance-trace-env.ts` — `readCellTraceEnabled`/`setCellTraceEnabled`) writes `TURBOPANEL_DAEMON_DEBUG` into **both** `/etc/turbopanel/instance/runtime.env` and `runtime.dev-vars` (so it applies to Deno and the Workers `wrangler dev` DO identically) and then restarts `turbopanel-instance` (reusing the existing restart-overlay flow) to apply it. The **Cell trace** viewer (`src/components/cell-trace-view.tsx`, `src/hooks/use-cell-trace-log.ts`, `src/lib/cell-trace-log.ts`) is a Developer sub-view that tails and filters the instance log (`/var/log/turbopanel/instance/instance.log` + `.err.log`) down to the `daemon-cell`/`command-consumer`-tagged trace lines, reached via the `view-cell-trace` action and rendered by `src/components/developer-panel.tsx`. Enabling `TURBOPANEL_DAEMON_DEBUG` now also surfaces per-call-site Durable Object storage-op counters (`storageReads`/`storageWrites`/`storageByCallSite`) on the cell diagnostics for billing audits; canonical detail lives in `~/instance/AGENTS.md` (Daemon Cell).

## Testing

Local commands:

| Command | Purpose |
| ------- | ------- |
| `pnpm test` | Vitest once (`vitest run`) |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm test:coverage` | Vitest + LCOV (`coverage/lcov.info`) |
| `pnpm typecheck` | `tsc --noEmit` |

**Vitest convention:** place suites at `src/**/*.test.ts` / `src/**/*.test.tsx`. Use the `node` environment (Ink TUI, not a browser). Import `describe` / `it` / `expect` from `vitest` — do not use `node:test` + `node:assert/strict`. Assert shapes with `new TypeError()` per `typescript:S7786`.

**Shared test helpers:** this repo has no local shared test-helper module. Daemon test authors must use the shared doubles in `../daemon/src/testing/` instead of hand-rolled ones (see that repo’s Testing section).

**Pre-commit** (`.githooks/pre-commit`): runs `scripts/scan-secrets.sh` first (never skippable), then `pnpm typecheck` and `pnpm test`. Set `TURBOPANEL_SKIP_HOOK_TESTS` (any non-empty value) to skip typecheck/tests after the secret scan — useful when the toolchain or `node_modules/` is absent; the hook also exits 0 with a notice when pnpm or `node_modules/` is missing (run `./console` or `pnpm install`). `./console` idempotently sets `core.hooksPath=.githooks` via `tp_ensure_git_hooks_path` in `scripts/lib/git-github-ssh.sh`.

**Gate matrix** (one policy with the daemon repo):

| Stage | dev | daemon | Rationale |
| ----- | --- | ------ | --------- |
| pre-commit | scan-secrets → `pnpm typecheck` → `pnpm test` | scan-secrets → `fmt:check` → `lint` → tests | fast local feedback |
| PR → `trunk` | `verify.yml` | `verify.yml` | blocks merge |
| push `trunk` | `verify.yml` | `verify.yml`; `publish` job `needs: verify` | nothing compiles from failing code |
| promote → canary/rc/release | n/a | **artifact integrity only** (S3 sha256/size + CDN fetch) | no new code enters after publish |

**Coverage:** SonarCloud’s Sonar-way quality gate (CI scan in `.github/workflows/verify.yml` with `sonar.qualitygate.wait=true`) requires **≥ 80% coverage on new code**. Missing `SONAR_TOKEN` soft-fails / skips the Sonar steps (`continue-on-error`) so typecheck/tests still gate; wire the secret on the repo/org when ready. Sibling repos (`instance`, `ui`, `website`) have no Actions verify — they use SonarCloud Automatic Analysis only.

## Ansible dev overlay

The **Ansible dev overlay** lives in `<dev checkout>/orchestration/` and overrides the daemon's production roles with dev-user parameters (the daemon still executes Ansible). Set `TURBOPANEL_MODE=development` during dev converge.

The **`dev-shell-path`** role (dev-only) installs `/etc/profile.d/turbopanel-dev-deno.sh` (bash/login `sh`) and `/etc/zsh/zshenv.d/turbopanel-dev-deno` plus a guarded block in `/etc/zsh/zshenv` so **all zsh invocations** (including Oh My Zsh interactive shells — Debian does not source `/etc/zsh/zshrc.d`) prepend **`/opt/turbopanel/vendor/deno/current`** to `PATH`. That directory is the `deno-runtime` `current` symlink — version bumps only require updating the pin in the daemon role and `DENO_VERSION` in `scripts/lib/paths.sh` / `src/lib/paths.ts`, then re-converging.

### Development Caddyfile

Co-located hosts load **`orchestration/Caddyfile`** (not `~/instance/Caddyfile`) when `turbopanel_dev_user` is set — wired by the daemon `instance-launch` role via `turbopanel_caddyfile`. That file owns:

- HTTPS `:8443` plus plaintext `:8880` (always on; no serve-time flag)
- Expo reverse_proxy when `TURBOPANEL_UI_MODE=dev` (with `expo-loading.html` for cold-start 502s)
- Optional wrangler upstream when `TURBOPANEL_INSTANCE_RUNTIME=workers`
- `/downloads/daemon/*` and the install script at **`/run.sh`** from the daemon checkout

The instance repo's `Caddyfile` stays production-only (HTTPS + Deno socket + static UI). See **`../instance/AGENTS.md`** (Caddy) and **`../daemon/AGENTS.md`** (plaintext HTTP client gate).

## Shell libraries

- **`scripts/lib/privileges.sh`** — POSIX sudo re-exec helpers (`tp_ensure_privileges`), logging helpers, `tp_is_interactive()` (stdin TTY or readable/writable `/dev/tty`).
- **`scripts/lib/paths.sh`** — `/opt/turbopanel` path constants; pinned `NODE_VERSION` + vendored `NODE_BIN`/`PNPM_BIN` under `vendor/node/current/bin/`; pinned `DENO_VERSION` + `VENDORED_DENO_BIN` (`vendor/deno/current/deno`).
- **`scripts/lib/packages.sh`** — apt prerequisite checks: `tp_require_host_commands` (curl/tar/sha256sum).
- **`scripts/lib/runtime.sh`** — pinned **Node** install from the `nodejs.org` tarball into `/opt/turbopanel/vendor/node/<version>/` plus Corepack/pnpm (`tp_ensure_node_runtime`); `tp_export_deno_path` prepends vendored Deno for hooks/child shells.
- **`scripts/lib/dev-identity.sh`** — resolve dev user from process UID (`tp_resolve_dev_identity`).
- **`scripts/lib/dev-prerequisites.sh`** — curl/sudo/dev-user checks shared by `develop.sh` and `./console`. When sudo still requires a password, optionally prompts to install `/etc/sudoers.d/turbopanel-dev-nopasswd` (full `NOPASSWD` for the dev user on local dev hosts). Set `TURBOPANEL_DEV_SKIP_NOPASSWD_SUDO=1` to skip the prompt.
- **`scripts/lib/git-github-ssh.sh`** — git identity prompts, SSH key generation, GitHub verification (used by `develop.sh`).

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
- **`scripts/develop.sh` only installs this repo** — no runtime, no platform repos.
- **`console` owns the Node runtime** (for this repo) and starting the TUI. It does **not** install Deno or other platform runtimes.
- **`develop.sh` clones to `~/dev`** (or `${TURBOPANEL_DEV_ROOT}/dev` when set), alongside sibling repos under the same dev root.
- Developer identity (`TURBOPANEL_DEV_USER`, `TURBOPANEL_DEV_UID`, `TURBOPANEL_DEV_GID`) is resolved from the **process UID** via `getent passwd` (`tp_resolve_dev_identity()` in `scripts/lib/dev-identity.sh`). **`USER` / `LOGNAME` are never trusted.** Unresolved identities and `root` are rejected; the only root exception is a validated `SUDO_USER` passwd entry when the console runs under `sudo`.
- Node is pinned in `scripts/lib/paths.sh` (`NODE_VERSION` **`24.17.0`**), downloaded from `nodejs.org`, vendored to `/opt/turbopanel/vendor/node/<version>/` with a `current` symlink. pnpm is pinned solely by `packageManager` in `package.json` and provisioned via Corepack.
- **`TURBOPANEL_MODE=development`** during dev converge. Source repos default under `$HOME` via `TURBOPANEL_DEV_ROOT` and per-repo `TURBOPANEL_<DIR>_REPO` overrides.
- Daemon bootstrap, systemd units, and Docker containers run as the **current dev user** — no `tp` / `tpctrl` / `tpcache` service accounts are created in dev.
- Purge/reset stops and removes the daemon systemd unit **`turbopaneld.service`**, dev FHS state under `/etc/turbopanel`, `/var/lib/turbopanel`, `/var/log/turbopanel`, `/run/turbopanel`, and runtimes under `/opt/turbopanel/vendor`.
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

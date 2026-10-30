# AGENTS.md

## What this repo is

The **dev** repository ([TurboPanel/dev](https://github.com/TurboPanel/dev)) is the **TurboPanel Development Environment** — contributor tooling only, not production or self-hosted install. It is a minimal terminal UI built on [Ink](https://github.com/vadimdemedes/ink) 7, run on **Node** via **Vite (`vite-node`)**. Watch mode uses a custom Vite dev runner (`scripts/hot-reload.tsx`) that keeps the Ink process mounted and reloads changed `src/` modules. Contributors run it inside a **Vagrant** guest with six sibling checkouts mounted from the host (`dev`, `turbopaneld`, `turbopanel`, `ui`, `website`, `.github`).

**License:** AGPL-3.0-only. Trademarks are not granted by the software license ([`TRADEMARKS.md`](./TRADEMARKS.md)). Third-party components keep their own licenses ([`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)). Published story: `../website` `/open-source` and `docs/getting-started/licensing.mdx`. Contributions require the [CLA](https://github.com/TurboPanel/.github/blob/trunk/CLA.md). **Maturity:** **Private alpha**. README is product-facing; AGENTS.md is maintainer-facing.

## Nested Guides

The nearest `AGENTS.md` to the file you edit applies on top of this one:

- [`src/AGENTS.md`](./src/AGENTS.md) — editing the console app: entry points, hot reload, `src/lib/` helper contracts, TypeScript style.
- [`scripts/AGENTS.md`](./scripts/AGENTS.md) — editing shell scripts: the shell libraries and POSIX `sh` rules.
- [`orchestration/AGENTS.md`](./orchestration/AGENTS.md) — editing the Ansible dev overlay or the development Caddyfile.
- [`.github/AGENTS.md`](./.github/AGENTS.md) — editing workflows, composite actions or rulesets: release promotion (including the break-glass ruleset route), Sonar, dependency advisories.
- [`docs/dev-environment.md`](./docs/dev-environment.md) — the Vagrant guest, filesystem layout, fresh-clone steps and Vagrantfile provisioning.
- [`docs/testing.md`](./docs/testing.md) — test details: cross-repo pin tests, secret scan, command table, pre-commit hook, gate matrix.

**This repo runs on Node, not Deno.** In dev the console bootstraps
orchestration and runs the **daemon from the dev user's home checkout**
(`~/turbopaneld`, derived from `TURBOPANEL_DEV_ROOT`; `TURBOPANEL_DAEMON_REPO` is an optional override) via Deno (`deno run main.ts`) — host Deno is
preferred, else the vendored runtime at
`/opt/turbopanel/vendor/deno/current/deno`. It never runs a
compiled daemon binary. Production installs (driven by `run.sh` + Ansible, **not**
this console) run **`turbopaneld.service`** on the FHS tree
(`/etc/turbopanel`, `/var/lib/turbopanel`, `/var/log/turbopanel`,
`/run/turbopanel`): native **`/opt/turbopanel/bin/turbopaneld`** when that binary
executes, otherwise **`turbopaneld.js`** via vendored Deno — the supported path
on hosts where the native binary cannot load (e.g. some Raspberry Pi kernels with
16 KiB pages; see the daemon repo's `src/paths/AGENTS.md` → "Filesystem layout & path
model"). Deno is still installed for the **instance** stack (and mailer) via the
`deno-runtime` Ansible role during dev converge.

**Target host:** Debian 13 (Trixie) inside the Vagrant guest. **Linux
contributors** use **Vagrant + libvirt** with the `debian/trixie64` box; **macOS
contributors** use **Vagrant + UTM** with guest box **`utm/bookworm`** (Debian
12) until a Trixie UTM box is available.

Canonical docs: https://turbopanel.io/docs/getting-started/development

`./console` launches the Developer Console, an Ink TUI with a **Services** area (service list, logs, per-service actions) and a **Developer** area (converge, optional services, run tests, cell trace, daemon rebuild). `src/tui.tsx` is a thin launcher that lazy-loads `src/console-app.tsx`; the screens live in `src/` (see [`src/AGENTS.md`](./src/AGENTS.md)). It is used occasionally, so keep it working and keep these guides accurate.

## Entry points

| Script | Purpose |
|--------|---------|
| `vagrant up` / `vagrant ssh` | **Canonical:** boot guest from `dev/`, then SSH in and run `dev/console`. |
| `./console` | Ensure pinned Node (sudo on first run), `pnpm install`, launch `src/tui.tsx` via `vite-node` (run **inside the guest**; from `$HOME` that is `dev/console`). |
| `./console --watch` | Same, but use `scripts/hot-reload.tsx` for live reload on `src/` changes. |
| `pnpm dev` | Run `src/tui.tsx` directly via `vite-node` (requires Node on PATH). |
| `pnpm dev:watch` | Run `scripts/hot-reload.tsx`, which keeps Ink mounted and rerenders on `src/` changes. |
| `./scripts/sync.sh` | Push `turbopanel/src/db/schema.ts` → live Postgres (drizzle-kit push; Deno dev convenience). |
| `./scripts/introspect.sh` | Pull live Postgres → `turbopanel/src/db/schema.ts` (drizzle-kit introspect). |

**Typical flow:**

```bash
# siblings: …/turbopanel/{dev,turbopaneld,turbopanel,ui,website,.github}
cd …/turbopanel/dev
vagrant up
vagrant ssh
# inside guest:
dev/console
```

## Responsibilities

- **`console`** — runs the prerequisite check, ensures pinned **Node** (`/opt/turbopanel/vendor/node/current/bin/node`, runs this repo) is installed, installs Corepack via vendored npm when Node did not ship it (25+), enables Corepack/pnpm, runs `pnpm install`, and launches the Ink TUI via `vite-node`. Add `--watch` to use `scripts/hot-reload.tsx`, which keeps the Ink process alive and rerenders when imported `src/` modules change. When stdin/stdout/stderr are not TTYs, reattaches stdio to `/dev/tty` when `tp_is_interactive()` succeeds. Does **not** install Deno via `./console` itself (Deno bootstrap is via `ensureBootstrapDeno` during daemon install).
- **`src/tui.tsx`** — Ink entrypoint (uses `alternateScreen`): shows a boot screen, then lazy-loads `src/console-app.tsx`, whose `AppView` (`src/app.tsx`) renders the one-row `MenuBar` (`← →` switches the **Services** and **Developer** areas), the bordered main panel and the one-row `StatusBar`. Ctrl-C exits. Platform install, service monitoring and stack actions live in `src/lib/` and `src/hooks/use-console-app.ts`.

## Node app

Moved to [`src/AGENTS.md`](./src/AGENTS.md) — Ink TUI entry points, hot-reload
model, and the `src/lib/` helper contracts (paths, developer client,
daemon-exec, dev-env readiness, cell trace, test runner, daemon rebuild).

## Testing

**Run tests inside the Vagrant guest, never on the host.** Host VirtFS
checkouts do not have a usable Node/pnpm/Deno tree (`node_modules` is
bind-mounted inside the guest from `/var/lib/turbopanel-dev/…`). Agents
must SSH into the VM. From the host `dev` checkout (where the
`Vagrantfile` lives):

```bash
# CI-parity for every sibling (static gates + test:coverage LCOV, minus Sonar upload).
# From the host this re-execs via vagrant ssh; same path inside the guest.
./scripts/ci-verify.sh
./scripts/ci-verify.sh ui website
./scripts/ci-verify.sh --coverage-only

# one-shot (prefix vendored Node + Deno)
vagrant ssh -c 'export PATH="/opt/turbopanel/vendor/node/current/bin:/opt/turbopanel/vendor/deno/current:$PATH"; cd ~/dev && pnpm test'
vagrant ssh -c 'export PATH="/opt/turbopanel/vendor/node/current/bin:/opt/turbopanel/vendor/deno/current:$PATH"; cd ~/turbopaneld && deno task test'
vagrant ssh -c 'export PATH="/opt/turbopanel/vendor/node/current/bin:/opt/turbopanel/vendor/deno/current:$PATH"; cd ~/turbopanel && pnpm test:do'
# DuckDB compile/packaging gate — run on BOTH guest architectures (x64 + arm64)
vagrant ssh -c 'export PATH="/opt/turbopanel/vendor/node/current/bin:/opt/turbopanel/vendor/deno/current:$PATH"; cd ~/turbopanel && deno task duckdb:smoke'
vagrant ssh -c 'export PATH="/opt/turbopanel/vendor/node/current/bin:/opt/turbopanel/vendor/deno/current:$PATH"; cd ~/ui && pnpm test'
vagrant ssh -c 'export PATH="/opt/turbopanel/vendor/node/current/bin:/opt/turbopanel/vendor/deno/current:$PATH"; cd ~/website && pnpm typecheck'
```

Do not run `pnpm test` / `deno task test` against the host sibling trees.

**Vitest convention:** place suites at `src/**/*.test.ts` / `src/**/*.test.tsx`. Use the `node` environment (Ink TUI, not a browser). Import `describe` / `it` / `expect` from `vitest` — do not use `node:test` + `node:assert/strict`. Assert shapes with `new TypeError()` per `typescript:S7786`.

Test details (pin tests, secret scan, command table, pre-commit hook, gate matrix) are in [`docs/testing.md`](./docs/testing.md).

## Key conventions

- Default git branch is **`trunk`** everywhere.
- Git clones use **SSH** (`git@github.com:TurboPanel/...`), not HTTPS.
- **`console` owns the Node runtime** (for this repo) and starting the TUI. It does **not** install Deno or other platform runtimes.
- Contributors clone the six sibling repos on the host; Vagrant mounts them into the guest under `$HOME`.
- **`TURBOPANEL_MODE=development`** during dev converge. Source repos live under `TURBOPANEL_DEV_ROOT` (default `$HOME`); every consumer derives `<dev_root>/<repo>` itself. Per-repo `TURBOPANEL_<DIR>_REPO` keys are **optional overrides only** — `buildPlatformRepoEntries()` writes one into `daemon.env` only when it is set and differs from the derived default, and `writeDaemonBaseEnv` / `writeDaemonInstanceEnv` remove any stale per-repo key on every write.
- Daemon bootstrap, systemd units, and Docker containers run as the **current dev user** — no `tp` / `tpctrl` / `tpcache` service accounts are created in dev.
- Purge/reset stops and removes the daemon systemd unit **`turbopaneld.service`**, dev FHS state under `/etc/turbopanel`, `/var/lib/turbopanel`, `/var/log/turbopanel`, `/run/turbopanel`, and runtimes under `/opt/turbopanel/vendor`.
- Do not commit secrets or environment-specific config.

## What agents must NOT do

- Do not reintroduce `deno.json`/`deno.lock` to this repo or use Deno to run the console — this repo is Node/pnpm/Vite.
- Do not add Deno installation or upgrade logic to `./console` or `scripts/lib/runtime.sh` — development Deno is resolved from host PATH when present and otherwise auto-vendored by the orchestration path (`ensureBootstrapDeno` / `ensureOrchestrationDenoBin`); production Deno remains platform-managed. Keep `./console` and `scripts/lib/runtime.sh` Node-only.
- Do not reintroduce a host-side clone/bootstrap installer or a Workers Static Assets host for contributor setup — use Vagrant + pre-cloned sibling repos; docs live at turbopanel.io.
- Do not add platform repo cloning to shell scripts — that belongs in the TUI (`src/lib/platform-install.ts`).
- Do not hardcode developer UID/GID — always read from `tp_resolve_dev_identity()` / `tp_require_dev_identity()` in shell scripts.
- Do not reintroduce `pull.sh`.
- Platform repos live under **`$HOME`** (via `TURBOPANEL_DEV_ROOT`; `TURBOPANEL_<DIR>_REPO` only as an explicit override) — do not clone into `/opt/turbopanel/platform`.
- Do not bump the pinned Node version without updating `scripts/lib/paths.sh` and docs. Bump pnpm by updating `packageManager` in `package.json` only (keep the hashed Corepack pin), then run `pnpm install` so each sibling `pnpm-lock.yaml` records the `packageManagerDependencies` catalog — `--frozen-lockfile` (CI and Cloudflare) fails without it. Each pnpm checkout needs `pnpm-workspace.yaml` `allowBuilds` for packages whose postinstalls must run (`esbuild` / `workerd` for wrangler; this repo at least `esbuild`). pnpm 12 `strictDepBuilds` otherwise fails the install with `ERR_PNPM_IGNORED_BUILDS`. CI `pnpm/action-setup` must stay at **v6.1.0+** — v4 cannot install pnpm 12's native binary.
- Do not commit directly to `trunk` — use a feature branch and open a PR.
- Do not run unit tests, typecheck, or lint on the **host** checkout — use `vagrant ssh` (or the TUI Run tests / Services **T**). Host VirtFS trees lack a usable Node/pnpm/Deno `node_modules`.
- Do not describe the Developer Console as removed or minimal: the Services and Developer areas exist, so update the guides when those screens change.

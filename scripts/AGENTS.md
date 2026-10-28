# Shell Scripts (`scripts/`) — AGENTS.md

Repo context: `../AGENTS.md`.

## Shell libraries

- **`scripts/lib/privileges.sh`** — POSIX sudo re-exec helpers (`tp_ensure_privileges`), logging helpers, `tp_is_interactive()` (stdin TTY or readable/writable `/dev/tty`).
- **`scripts/lib/paths.sh`** — `/opt/turbopanel` path constants; pinned `NODE_VERSION` + vendored `NODE_BIN`/`PNPM_BIN` under `vendor/node/current/bin/`; pinned `DENO_VERSION` + `VENDORED_DENO_BIN` (`vendor/deno/current/deno`).
- **`scripts/lib/packages.sh`** — apt prerequisite checks: `tp_require_host_commands` (curl/tar/sha256sum).
- **`scripts/lib/runtime.sh`** — pinned **Node** install from the `nodejs.org` tarball into `/opt/turbopanel/vendor/node/<version>/` plus Corepack/pnpm (`tp_ensure_node_runtime` / `tp_ensure_corepack_pnpm`; Corepack is `npm install -g` on Node 25+); `tp_export_deno_path` prepends vendored Deno for hooks/child shells.
- **`scripts/lib/dev-identity.sh`** — resolve dev user from process UID (`tp_resolve_dev_identity`).
- **`scripts/lib/dev-prerequisites.sh`** — curl/sudo/dev-user checks for `./console`. When sudo still requires a password, optionally prompts to install `/etc/sudoers.d/turbopanel-dev-nopasswd` (full `NOPASSWD` for the dev user on local dev hosts). Set `TURBOPANEL_DEV_SKIP_NOPASSWD_SUDO=1` to skip the prompt.
- **`scripts/lib/git-github-ssh.sh`** — git identity prompts, SSH key generation, GitHub verification (used by `./console` when needed).

## Shell Conventions

- Shell scripts are **POSIX `sh`** — no bashisms. Sonar `shelldre:S7688` (`[[` vs `[`) and `shelldre:S7682` (explicit `return`) are ignored in `sonar-project.properties` / `.sonarcloud.properties` for that reason.
- Developer identity (`TURBOPANEL_DEV_USER`, `TURBOPANEL_DEV_UID`, `TURBOPANEL_DEV_GID`) is resolved from the **process UID** via `getent passwd` (`tp_resolve_dev_identity()` in `scripts/lib/dev-identity.sh`). **`USER` / `LOGNAME` are never trusted.** Unresolved identities and `root` are rejected; the only root exception is a validated `SUDO_USER` passwd entry when the console runs under `sudo`.
- Node is pinned in `scripts/lib/paths.sh` (`NODE_VERSION` **`26.7.0`**), downloaded from `nodejs.org`, vendored to `/opt/turbopanel/vendor/node/<version>/` with a `current` symlink. pnpm is pinned solely by `packageManager` in `package.json` and provisioned via Corepack. Node 25+ dropped the bundled `corepack` binary, so `tp_ensure_corepack` installs the standalone package with vendored npm into that prefix before `corepack enable` / `prepare`. `tp_corepack_env` sets `COREPACK_DEFAULT_TO_LATEST=0` and `COREPACK_ENABLE_AUTO_PIN=0` so `pnpm --version` after `corepack prepare --activate` stays on that pin (Corepack otherwise reports the newest npm release when `./console` is launched from `$HOME`, which produced `expected vX, got Y` on every bump). The version check runs from the checkout so Corepack reads that `package.json`.

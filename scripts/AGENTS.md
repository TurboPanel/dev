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

## Contributor Setup (`setup.sh`)

- **`scripts/setup.sh`** is the one entry for every contributor; `doctor` and `status` are its read-only subcommands. It reads the repo list from `repos.list` (name, default branch, optional `optional` flag), and `vagrant-up.sh` reads the same file.
- **Folder:** all repos sit in one folder, by default the folder named `turbopanel` that holds this checkout, else `./turbopanel`; `--dir` overrides. The mode file is `<folder>/.turbopanel-dev-mode` (the folder that holds the repos, not its parent), shell-sourceable `key='value'` lines: `TURBOPANEL_DEV_ENV` (`direct` or `vagrant`; never `TURBOPANEL_MODE`, which means development versus production), `dev_root`, `clone_protocol`, `github_login`, `role_<repo>` (`role_github` for `.github`), `created` (kept across reruns) and `updated`. Scripts read it with `sed`, not by sourcing it; `ci-verify.sh` reads `TURBOPANEL_DEV_ENV` from `$REPO_ROOT/../.turbopanel-dev-mode`.
- **Roles** come from `gh api repos/TurboPanel/<repo> --jq .permissions.push`: `maintainer` (origin = TurboPanel repo, no upstream), `contributor` (origin = the user's fork, upstream = TurboPanel repo; also with `--fork`) or `readonly` (not logged in). `.github` is never forked for anyone: a fork of an org's `.github` repo becomes the user's own account-wide community health repo. An API failure keeps the role from the last run.
- **Safety:** clones go to `<folder>/.setup-clone-<repo>` and are renamed on success; reruns fetch with `GIT_TERMINAL_PROMPT=0`, fast-forward the default branch only when it is clean and checked out (or not checked out at all), and never reset, stash or switch. An existing folder that is not a checkout, or a remote it does not recognise, is left alone with a message.
- **Direct mode** runs `sudo env TURBOPANEL_DEV_ROOT=<folder> sh vm-bootstrap.sh <user>` once and is offered only on Debian 13 outside a container; macOS and other hosts get Vagrant only.
- **Not provable in CI:** the fork call (`gh repo fork --clone=false`, then polling until the fork answers) and the permissions API need a real GitHub login; the tests in `src/lib/setup-script.test.ts` stand in a fake `gh` and `file://` bare repos (`TURBOPANEL_SETUP_REMOTE_BASE`, `TURBOPANEL_SETUP_OS_RELEASE`, `TURBOPANEL_SETUP_FORK_WAIT` are test-only overrides).

## Shell Conventions

- Shell scripts are **POSIX `sh`** — no bashisms. Sonar `shelldre:S7688` (`[[` vs `[`) and `shelldre:S7682` (explicit `return`) are ignored in `sonar-project.properties` / `.sonarcloud.properties` for that reason.
- Developer identity (`TURBOPANEL_DEV_USER`, `TURBOPANEL_DEV_UID`, `TURBOPANEL_DEV_GID`) is resolved from the **process UID** via `getent passwd` (`tp_resolve_dev_identity()` in `scripts/lib/dev-identity.sh`). **`USER` / `LOGNAME` are never trusted.** Unresolved identities and `root` are rejected; the only root exception is a validated `SUDO_USER` passwd entry when the console runs under `sudo`.
- Node is pinned in `scripts/lib/paths.sh` (`NODE_VERSION` **`26.7.0`**), downloaded from `nodejs.org`, vendored to `/opt/turbopanel/vendor/node/<version>/` with a `current` symlink. pnpm is pinned solely by `packageManager` in `package.json` and provisioned via Corepack. Node 25+ dropped the bundled `corepack` binary, so `tp_ensure_corepack` installs the standalone package with vendored npm into that prefix before `corepack enable` / `prepare`. `tp_corepack_env` sets `COREPACK_DEFAULT_TO_LATEST=0` and `COREPACK_ENABLE_AUTO_PIN=0` so `pnpm --version` after `corepack prepare --activate` stays on that pin (Corepack otherwise reports the newest npm release when `./console` is launched from `$HOME`, which produced `expected vX, got Y` on every bump). The version check runs from the checkout so Corepack reads that `package.json`.

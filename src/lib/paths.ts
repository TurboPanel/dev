export const TURBOPANEL_ROOT = "/opt/turbopanel";

/** Co-located platform repo dir names (daemon/instance/ui/website). */
export const PLATFORM_REPO_DIRS = ["daemon", "instance", "ui", "website"] as const;

/**
 * Development source-repo root. Source repos live under this root — defaults to
 * the dev user's home (`$HOME`), overridable with `TURBOPANEL_DEV_ROOT`.
 */
export function resolveDevRoot(): string {
  return (
    process.env.TURBOPANEL_DEV_ROOT?.trim() ||
    process.env.HOME?.trim() ||
    TURBOPANEL_ROOT
  );
}

/** Env key for an explicit repo checkout override (`TURBOPANEL_<DIR>_REPO`). */
export function platformRepoEnvKey(dir: string): string {
  return `TURBOPANEL_${dir.toUpperCase()}_REPO`;
}

/** Production FHS default for vendored runtimes (`/opt/turbopanel/vendor`). */
export const DEFAULT_RUNTIMES_DIR = `${TURBOPANEL_ROOT}/vendor`;

/**
 * Resolve the vendored runtime root.
 *
 * Honors `TURBOPANEL_RUNTIMES_DIR`, then `TURBOPANEL_RUNTIME_DIR`, then
 * {@link DEFAULT_RUNTIMES_DIR}. Mirrors daemon `resolveRuntimesDir()`.
 */
export function resolveRuntimesDir(): string {
  const override = process.env.TURBOPANEL_RUNTIMES_DIR?.trim() ||
    process.env.TURBOPANEL_RUNTIME_DIR?.trim();
  const dir = override || DEFAULT_RUNTIMES_DIR;
  return dir.replace(/\/+$/, "") || "/";
}

export const RUNTIMES_DIR = resolveRuntimesDir();
/** Pinned Node.js for the dev console (matches node-runtime Ansible role). */
export const NODE_VERSION = "24.17.0";
export const NODE_BIN = `${RUNTIMES_DIR}/node/current/bin/node`;
export const PNPM_BIN = `${RUNTIMES_DIR}/node/current/bin/pnpm`;

/** Co-located dev Ansible overlay under the daemon checkout. */
export function devOrchestrationDir(): string {
  return `${daemonRepoPath()}/dev/orchestration`;
}

/** FHS mutable dirs (dev shares the production paths, dev-owned at runtime). */
export const CONFIG_DIR = "/etc/turbopanel";
export const LOG_DIR = "/var/log/turbopanel";

export function instanceConfigDir(): string {
  return `${CONFIG_DIR}/instance`;
}

export function instanceRuntimeEnvPath(): string {
  return `${instanceConfigDir()}/runtime.env`;
}

export function instanceRuntimeDevVarsPath(): string {
  return `${instanceConfigDir()}/runtime.dev-vars`;
}
export const UV_CACHE_DIR = `${RUNTIMES_DIR}/uv/cache`;
/** Pinned managed Python (matches daemon `PYTHON_VERSION`). */
export const PYTHON_VERSION = "3.14";
export const PYTHON_RUNTIME_DIR = `${RUNTIMES_DIR}/python/${PYTHON_VERSION}`;
export const PYTHON_CURRENT_DIR = `${RUNTIMES_DIR}/python/current`;
/** `UV_PYTHON_INSTALL_DIR` target for orchestration bootstrap. */
export const PYTHON_INSTALL_DIR = PYTHON_RUNTIME_DIR;
/**
 * Pinned Deno version for the dev console's bootstrap fallback + status label.
 *
 * Must match `deno_version` in the daemon's
 * `orchestration/roles/deno-runtime/defaults/main.yml` (and `TP_DENO_VERSION`
 * in the daemon `scripts/run.sh`) so the version the console would install when
 * host Deno is absent matches the one Ansible converges into
 * `/opt/turbopanel/vendor/deno`.
 */
export const DENO_VERSION = "2.9.1";
export const VENDORED_DENO_BIN = `${RUNTIMES_DIR}/deno/current/deno`;

export function platformRepoPath(dir: string): string {
  const override = process.env[platformRepoEnvKey(dir)]?.trim();
  return override || `${resolveDevRoot()}/${dir}`;
}

export function daemonRepoPath(): string {
  return platformRepoPath("daemon");
}

export function instanceRepoPath(): string {
  return platformRepoPath("instance");
}

export function platformCaCertPath(): string {
  return `${instanceRepoPath()}/certs/ca.crt`;
}

/** Managed repo-root entries for `daemon.env` (override-aware). */
export function buildPlatformRepoEntries(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const dir of PLATFORM_REPO_DIRS) {
    entries[platformRepoEnvKey(dir)] = platformRepoPath(dir);
  }
  return entries;
}

/**
 * Daemon env file.
 *
 * Dev and managed installs share the FHS config path
 * (`/etc/turbopanel/daemon.env`, `EnvironmentFile=` on `turbopaneld.service`);
 * in dev it is dev-user-owned at runtime.
 */
export const DAEMON_ENV_PATH = `${CONFIG_DIR}/daemon.env`;

export function daemonBootstrapScript(): string {
  return `${daemonRepoPath()}/scripts/bootstrap-orchestration.ts`;
}

export function daemonOrchestrationScript(): string {
  return `${daemonRepoPath()}/scripts/run-orchestration-action.ts`;
}

export function daemonDenoConfig(): string {
  return `${daemonRepoPath()}/deno.json`;
}

/** Co-located dev only — git branch for platform checkouts and Upgrade System. Not written on release/binary daemon installs. */
export const TURBOPANEL_TRUNK_BRANCH = "trunk";
export const DAEMON_ENV_TRUNK_BRANCH_KEY = "TURBOPANEL_TRUNK_BRANCH" as const;

export const DAEMON_REPO = {
  dir: "daemon",
  repo: "turbopanel/turbopanel-daemon",
} as const;

/**
 * systemd unit name for the co-located dev daemon.
 *
 * Matches `turbopanel_service_name` in the daemon's `daemon-launch` role and
 * `SERVICE_NAME` in `scripts/install-daemon-systemd.sh` (renamed from the legacy
 * `turbopanel-daemon`). The install script migrates old hosts by removing the
 * legacy unit; the console cleans it up on purge/reset too. Managed/production
 * installs run the same-named unit from `/opt/turbopanel/bin/turbopaneld`.
 */
export const DAEMON_SYSTEMD_UNIT = "turbopaneld";
/** Pre-rename unit name, still cleaned up for hosts installed before the rename. */
export const LEGACY_DAEMON_SYSTEMD_UNIT = "turbopanel-daemon";

export function consoleLogDir(): string {
  return `${resolveDevRoot()}/.local/console`;
}

export const CONSOLE_LOG_DIR = consoleLogDir();
export const CONVERGE_SERVICE_LOG_DIR = `${CONSOLE_LOG_DIR}/converge`;
export const CONSOLE_LAST_TASK_ERROR_LOG =
  `${CONSOLE_LOG_DIR}/last-task-error.log`;

export function convergeServiceLogPath(serviceId: string): string {
  return `${CONVERGE_SERVICE_LOG_DIR}/${serviceId}.log`;
}

/**
 * Daemon logs.
 *
 * Dev and managed installs share the FHS log path (`/var/log/turbopanel/`);
 * in dev the console tails these dev-user-owned files.
 */
export const DAEMON_LOG_PATH = `${LOG_DIR}/daemon.log`;
export const DAEMON_ERR_LOG_PATH = `${LOG_DIR}/daemon.err.log`;

export function sshRepoUrl(repo: string): string {
  return `git@github.com:${repo}.git`;
}

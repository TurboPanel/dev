export const TURBOPANEL_ROOT = "/opt/turbopanel";
export const TURBOPANEL_PLATFORM = `${TURBOPANEL_ROOT}/platform`;
export const RUNTIMES_DIR = `${TURBOPANEL_ROOT}/runtimes`;
/** Runtime-consumable copy of turbopanel-dev orchestration for turbopanel converge. */
export const DEV_ORCHESTRATION_STAGED_DIR = `${TURBOPANEL_ROOT}/dev-orchestration`;
export const UV_CACHE_DIR = `${RUNTIMES_DIR}/uv/cache`;
export const PYTHON_INSTALL_DIR = `${RUNTIMES_DIR}/python`;
export const ANSIBLE_COLLECTIONS_PATH =
  `${RUNTIMES_DIR}/ansible/galaxy-collections`;
/**
 * Pinned Deno version for the dev console's bootstrap fallback + status label.
 *
 * Must match `deno_version` in the daemon's
 * `orchestration/roles/deno-runtime/defaults/main.yml` (and `TP_DENO_VERSION`
 * in the daemon `scripts/run.sh`) so the version the console would install when
 * host Deno is absent matches the one Ansible converges into
 * `/opt/turbopanel/runtimes/deno`.
 */
export const DENO_VERSION = "2.9.0";
export const SYSTEM_DENO_BIN = "/usr/local/bin/deno";
export const INSTANCE_DIR = `${TURBOPANEL_PLATFORM}/instance`;
export const PLATFORM_CA_CERT_PATH = `${INSTANCE_DIR}/certs/ca.crt`;
export const DAEMON_REPO_DIR = `${TURBOPANEL_PLATFORM}/daemon`;
/**
 * Co-located dev daemon env file (source mode: `deno run … --env-file=.env`).
 *
 * This is the dev-only path. Managed/production installs read
 * `/etc/turbopanel/daemon.env` (`EnvironmentFile=` on `turbopaneld.service`) and
 * are never touched by the dev console.
 */
export const DAEMON_ENV_PATH = `${DAEMON_REPO_DIR}/.env`;
export const DAEMON_BOOTSTRAP_SCRIPT =
  `${DAEMON_REPO_DIR}/scripts/bootstrap-orchestration.ts`;
export const DAEMON_ORCHESTRATION_SCRIPT =
  `${DAEMON_REPO_DIR}/scripts/run-orchestration-action.ts`;
export const DAEMON_DENO_CONFIG = `${DAEMON_REPO_DIR}/deno.json`;

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

export const CONSOLE_LOG_DIR = `${TURBOPANEL_PLATFORM}/.local/console`;
export const CONVERGE_SERVICE_LOG_DIR = `${CONSOLE_LOG_DIR}/converge`;
export const CONSOLE_LAST_TASK_ERROR_LOG =
  `${CONSOLE_LOG_DIR}/last-task-error.log`;

export function convergeServiceLogPath(serviceId: string): string {
  return `${CONVERGE_SERVICE_LOG_DIR}/${serviceId}.log`;
}

/**
 * Co-located dev daemon logs (checkout-local `logs/`).
 *
 * `daemon-systemd-setup.yml` points the dev `turbopaneld.service` at these files.
 * Managed/production installs log to `/var/log/turbopanel/daemon/` instead; the
 * dev console only ever tails the co-located checkout logs.
 */
export const DAEMON_LOG_PATH = `${DAEMON_REPO_DIR}/logs/daemon.log`;
export const DAEMON_ERR_LOG_PATH = `${DAEMON_REPO_DIR}/logs/daemon.err.log`;

export function sshRepoUrl(repo: string): string {
  return `git@github.com:${repo}.git`;
}

export function platformRepoPath(dir: string): string {
  return `${TURBOPANEL_PLATFORM}/${dir}`;
}

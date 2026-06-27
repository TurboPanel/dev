export const TURBOPANEL_ROOT = "/opt/turbopanel";
export const TURBOPANEL_PLATFORM = `${TURBOPANEL_ROOT}/platform`;
export const RUNTIMES_DIR = `${TURBOPANEL_ROOT}/runtimes`;
/** Runtime-consumable copy of turbopanel-dev orchestration for turbopanel converge. */
export const DEV_ORCHESTRATION_STAGED_DIR = `${TURBOPANEL_ROOT}/dev-orchestration`;
export const UV_CACHE_DIR = `${RUNTIMES_DIR}/uv/cache`;
export const PYTHON_INSTALL_DIR = `${RUNTIMES_DIR}/python`;
export const ANSIBLE_COLLECTIONS_PATH =
  `${RUNTIMES_DIR}/ansible/galaxy-collections`;
/** Must match daemon orchestration/roles/deno-runtime/defaults/main.yml deno_version. */
export const DENO_VERSION = "2.8.3";
export const SYSTEM_DENO_BIN = "/usr/local/bin/deno";
export const INSTANCE_DIR = `${TURBOPANEL_PLATFORM}/instance`;
export const PLATFORM_CA_CERT_PATH = `${INSTANCE_DIR}/certs/ca.crt`;
export const DAEMON_REPO_DIR = `${TURBOPANEL_PLATFORM}/daemon`;
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

export const CONSOLE_LOG_DIR = `${TURBOPANEL_PLATFORM}/.local/console`;
export const CONVERGE_SERVICE_LOG_DIR = `${CONSOLE_LOG_DIR}/converge`;
export const CONSOLE_LAST_TASK_ERROR_LOG =
  `${CONSOLE_LOG_DIR}/last-task-error.log`;

export function convergeServiceLogPath(serviceId: string): string {
  return `${CONVERGE_SERVICE_LOG_DIR}/${serviceId}.log`;
}

export const DAEMON_LOG_PATH = `${DAEMON_REPO_DIR}/logs/daemon.log`;
export const DAEMON_ERR_LOG_PATH = `${DAEMON_REPO_DIR}/logs/daemon.err.log`;

export function sshRepoUrl(repo: string): string {
  return `git@github.com:${repo}.git`;
}

export function platformRepoPath(dir: string): string {
  return `${TURBOPANEL_PLATFORM}/${dir}`;
}

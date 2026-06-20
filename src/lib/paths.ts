export const TURBOPANEL_ROOT = "/opt/turbopanel";
export const TURBOPANEL_PLATFORM = `${TURBOPANEL_ROOT}/platform`;
export const RUNTIMES_DIR = `${TURBOPANEL_ROOT}/runtimes`;
export const UV_CACHE_DIR = `${RUNTIMES_DIR}/uv/cache`;
export const PYTHON_INSTALL_DIR = `${RUNTIMES_DIR}/python`;
export const ANSIBLE_COLLECTIONS_PATH =
  `${RUNTIMES_DIR}/ansible/galaxy-collections`;
/** Must match daemon orchestration/roles/deno-runtime/defaults/main.yml deno_version. */
export const DENO_VERSION = "2.8.3";
export const SYSTEM_DENO_BIN = "/usr/local/bin/deno";
export const DAEMON_REPO_DIR = `${TURBOPANEL_PLATFORM}/daemon`;
export const DAEMON_ENV_PATH = `${DAEMON_REPO_DIR}/.env`;
export const DAEMON_BOOTSTRAP_SCRIPT =
  `${DAEMON_REPO_DIR}/scripts/bootstrap-orchestration.ts`;
export const DAEMON_ORCHESTRATION_SCRIPT =
  `${DAEMON_REPO_DIR}/scripts/run-orchestration-action.ts`;
export const DAEMON_BOOTSTRAP_COMPILED =
  `${DAEMON_REPO_DIR}/dist/turbopanel-bootstrap-orchestration`;
export const DAEMON_DENO_CONFIG = `${DAEMON_REPO_DIR}/deno.json`;

export const DAEMON_REPO = {
  dir: "daemon",
  repo: "turbopanel/turbopanel-daemon",
} as const;

export const CONSOLE_LOG_DIR = `${TURBOPANEL_PLATFORM}/.local/console`;
export const CONSOLE_LAST_TASK_ERROR_LOG =
  `${CONSOLE_LOG_DIR}/last-task-error.log`;

export const DAEMON_LOG_PATH = `${DAEMON_REPO_DIR}/logs/daemon.log`;
export const DAEMON_ERR_LOG_PATH = `${DAEMON_REPO_DIR}/logs/daemon.err.log`;

export function sshRepoUrl(repo: string): string {
  return `git@github.com:${repo}.git`;
}

export function platformRepoPath(dir: string): string {
  return `${TURBOPANEL_PLATFORM}/${dir}`;
}

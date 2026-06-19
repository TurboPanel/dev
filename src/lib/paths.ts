export const TURBOPANEL_ROOT = "/opt/turbopanel";
export const TURBOPANEL_PLATFORM = `${TURBOPANEL_ROOT}/platform`;
export const RUNTIMES_DIR = `${TURBOPANEL_ROOT}/runtimes`;
export const UV_CACHE_DIR = `${RUNTIMES_DIR}/uv/cache`;
export const PYTHON_INSTALL_DIR = `${RUNTIMES_DIR}/python`;
export const ANSIBLE_COLLECTIONS_PATH =
  `${RUNTIMES_DIR}/ansible/galaxy-collections`;
export const DAEMON_REPO_DIR = `${TURBOPANEL_PLATFORM}/daemon`;
export const DENO_VERSION = "2.8.3";
export const DENO_BIN = "/usr/local/bin/deno";
export const DAEMON_DENO_CONFIG = `${DAEMON_REPO_DIR}/deno.json`;

export const DAEMON_REPO = {
  dir: "daemon",
  repo: "turbopanel/turbopanel-daemon",
} as const;

export const CONSOLE_LOG_DIR = `${TURBOPANEL_PLATFORM}/.local/console`;
export const CONSOLE_LAST_TASK_ERROR_LOG =
  `${CONSOLE_LOG_DIR}/last-task-error.log`;

export function sshRepoUrl(repo: string): string {
  return `git@github.com:${repo}.git`;
}

export function platformRepoPath(dir: string): string {
  return `${TURBOPANEL_PLATFORM}/${dir}`;
}

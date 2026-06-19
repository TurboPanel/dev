export const TURBOPANEL_ROOT = "/opt/turbopanel";
export const TURBOPANEL_PLATFORM = `${TURBOPANEL_ROOT}/platform`;
export const RUNTIMES_DIR =
  Deno.env.get("TURBOPANEL_RUNTIMES_DIR")?.trim() || `${TURBOPANEL_ROOT}/runtimes`;
export const ANSIBLE_PLAYBOOK_BIN =
  `${RUNTIMES_DIR}/ansible/current/bin/ansible-playbook`;
export const ANSIBLE_LOCAL_TMP = `${RUNTIMES_DIR}/uv/cache/ansible-tmp`;
export const ANSIBLE_COLLECTIONS_PATH =
  `${RUNTIMES_DIR}/ansible/galaxy-collections`;
export const INSTANCE_DIR = `${TURBOPANEL_PLATFORM}/instance`;
export const DENO_VERSION = "2.8.3";
export const DENO_BIN =
  `${TURBOPANEL_ROOT}/runtimes/deno/${DENO_VERSION}/deno`;
export const WRANGLER_DEV_PORT = 18787;
export const WEBSITE_DEV_PORT = 19820;
export const WEBSITE_DEV_URL = `http://localhost:${WEBSITE_DEV_PORT}`;
export const CADDY_HTTPS = "https://localhost:8443";
export const PLATFORM_CA_CERT_PATH = `${INSTANCE_DIR}/certs/ca.crt`;

export const DAEMON_REPO = {
  dir: "daemon",
  repo: "turbopanel/turbopanel-daemon",
} as const;

export const PLATFORM_REPOS = [DAEMON_REPO] as const;

export const DAEMON_ENV_PATH = `${TURBOPANEL_PLATFORM}/daemon/.env`;
export const DAEMON_DENO_CONFIG = `${TURBOPANEL_PLATFORM}/daemon/deno.json`;
export const CONSOLE_LOG_DIR = `${TURBOPANEL_PLATFORM}/.local/console`;
export const CONSOLE_LAST_TASK_ERROR_LOG =
  `${CONSOLE_LOG_DIR}/last-task-error.log`;

export type RepoStatus = {
  dir: string;
  repo: string;
  present: boolean;
};

export type DevIdentity = {
  user: string;
  uid: number;
  gid: number;
};

export class DevIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevIdentityError";
  }
}

let cachedDevIdentity: DevIdentity | null = null;

function parsePasswdLine(
  line: string,
): { user: string; uid: number; gid: number } | null {
  const parts = line.trim().split(":");
  if (parts.length < 4) {
    return null;
  }
  const user = parts[0];
  const uid = Number.parseInt(parts[2], 10);
  const gid = Number.parseInt(parts[3], 10);
  if (!user || Number.isNaN(uid) || Number.isNaN(gid)) {
    return null;
  }
  return { user, uid, gid };
}

function getentPasswd(
  query: string,
): { user: string; uid: number; gid: number } | null {
  const proc = new Deno.Command("getent", {
    args: ["passwd", query],
    stdout: "piped",
    stderr: "null",
  }).outputSync();
  if (!proc.success) {
    return null;
  }
  return parsePasswdLine(new TextDecoder().decode(proc.stdout));
}

/** Resolve developer identity from process UID + passwd; rejects root unless SUDO_USER validates. */
export function resolveDevIdentity(): DevIdentity {
  if (cachedDevIdentity) {
    return cachedDevIdentity;
  }

  const effectiveUid = Deno.uid() ?? -1;
  if (effectiveUid < 0) {
    throw new DevIdentityError("Cannot determine process UID");
  }

  let identity: DevIdentity;

  if (effectiveUid === 0) {
    const sudoUser = Deno.env.get("SUDO_USER")?.trim();
    if (!sudoUser || sudoUser === "root") {
      throw new DevIdentityError(
        "Running as root without a valid SUDO_USER; invoke the console as your developer account",
      );
    }
    const entry = getentPasswd(sudoUser);
    if (!entry || entry.user === "root") {
      throw new DevIdentityError(
        `SUDO_USER ${sudoUser} does not resolve to a valid non-root passwd entry`,
      );
    }
    identity = { user: entry.user, uid: entry.uid, gid: entry.gid };
  } else {
    const entry = getentPasswd(String(effectiveUid));
    if (!entry || entry.user === "root") {
      throw new DevIdentityError(
        `UID ${effectiveUid} does not resolve to a valid non-root passwd entry`,
      );
    }
    const effectiveGid = Deno.gid() ?? entry.gid;
    if (effectiveGid < 0) {
      throw new DevIdentityError("Cannot determine process GID");
    }
    identity = { user: entry.user, uid: effectiveUid, gid: effectiveGid };
  }

  cachedDevIdentity = identity;
  return identity;
}

export function getDevUser(): string {
  return resolveDevIdentity().user;
}

export function getDevUid(): number {
  return resolveDevIdentity().uid;
}

export function getDevGid(): number {
  return resolveDevIdentity().gid;
}

export function sshRepoUrl(repo: string): string {
  return `git@github.com:${repo}.git`;
}

export function platformRepoPath(dir: string): string {
  return `${TURBOPANEL_PLATFORM}/${dir}`;
}

function isNotFound(err: unknown): boolean {
  return err instanceof Deno.errors.NotFound;
}

/** True when path exists; uses sudo for permission-denied paths under /opt/turbopanel. */
export function pathExists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch (err) {
    if (isNotFound(err)) {
      return false;
    }
  }

  if (!commandExistsSync("sudo")) {
    return false;
  }

  const proc = new Deno.Command("sudo", {
    args: ["test", "-e", path],
    stdout: "null",
    stderr: "null",
  }).outputSync();
  return proc.success;
}

function commandExistsSync(name: string): boolean {
  const proc = new Deno.Command("/bin/sh", {
    args: ["-c", 'command -v "$1" >/dev/null 2>&1', "_", name],
    stdout: "null",
    stderr: "null",
  }).outputSync();
  return proc.success;
}

export function checkPlatformRepos(): RepoStatus[] {
  return PLATFORM_REPOS.map(({ dir, repo }) => {
    const target = platformRepoPath(dir);
    return { dir, repo, present: pathExists(target) };
  });
}

export function denoRuntimeInstalled(): boolean {
  return pathExists(DENO_BIN);
}

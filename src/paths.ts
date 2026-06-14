export const TURBOPANEL_ROOT = "/opt/turbopanel";
export const TURBOPANEL_PLATFORM = `${TURBOPANEL_ROOT}/platform`;
export const DENO_VERSION = "2.8.3";
export const DENO_BIN =
  `${TURBOPANEL_ROOT}/runtimes/deno/v${DENO_VERSION}/bin/deno`;
export const WRANGLER_DEV_PORT = 18787;
export const CADDY_HTTPS = "https://localhost:8443";

export const DAEMON_REPO = {
  dir: "daemon",
  repo: "turbopanel/turbopanel-daemon",
} as const;

export const PLATFORM_REPOS = [DAEMON_REPO] as const;

export const DAEMON_ENV_PATH = `${TURBOPANEL_PLATFORM}/daemon/.env`;

export type RepoStatus = {
  dir: string;
  repo: string;
  present: boolean;
};

export function getDevUser(): string {
  return Deno.env.get("USER") ?? Deno.env.get("LOGNAME") ?? "unknown";
}

export function getDevUid(): number {
  return Deno.uid() ?? -1;
}

export function getDevGid(): number {
  return Deno.gid() ?? -1;
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

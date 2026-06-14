export const TURBOPANEL_ROOT = "/opt/turbopanel";
export const TURBOPANEL_PLATFORM = `${TURBOPANEL_ROOT}/platform`;
export const DENO_VERSION = "2.8.3";
export const DENO_BIN =
  `${TURBOPANEL_ROOT}/runtime/deno/v${DENO_VERSION}/bin/deno`;

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

export function checkPlatformRepos(): RepoStatus[] {
  return PLATFORM_REPOS.map(({ dir, repo }) => {
    let present = false;
    try {
      Deno.statSync(platformRepoPath(dir));
      present = true;
    } catch {
      present = false;
    }
    return { dir, repo, present };
  });
}

export function denoRuntimeInstalled(): boolean {
  try {
    Deno.statSync(DENO_BIN);
    return true;
  } catch {
    return false;
  }
}

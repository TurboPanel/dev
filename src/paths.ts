export const TURBOPANEL_ROOT = "/opt/turbopanel";
export const TURBOPANEL_PLATFORM = `${TURBOPANEL_ROOT}/platform`;
export const DENO_VERSION = "2.8.2";
export const DENO_BIN =
  `${TURBOPANEL_ROOT}/runtime/deno/v${DENO_VERSION}/bin/deno`;

export const PLATFORM_REPOS = [
  { dir: "instance", repo: "turbopanel/turbopanel" },
  { dir: "ui", repo: "turbopanel/turbopanel-ui" },
  { dir: "daemon", repo: "turbopanel/turbopanel-daemon" },
  { dir: "website", repo: "turbopanel/turbopanel-website" },
] as const;

export type RepoStatus = {
  dir: string;
  repo: string;
  present: boolean;
};

export function checkPlatformRepos(): RepoStatus[] {
  return PLATFORM_REPOS.map(({ dir, repo }) => {
    let present = false;
    try {
      Deno.statSync(`${TURBOPANEL_PLATFORM}/${dir}`);
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

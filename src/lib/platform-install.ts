import {
  DAEMON_REPO,
  platformRepoPath,
  sshRepoUrl,
  TURBOPANEL_PLATFORM,
} from "@turbopanel/lib/paths.ts";

const BRANCH = "trunk";
const TURBOPANEL_USER = "turbopanel";
const TURBOPANEL_GROUP = "turbopanel";

let turbopanelUserExistsCache: boolean | null = null;

async function turbopanelUserExists(): Promise<boolean> {
  if (turbopanelUserExistsCache !== null) {
    return turbopanelUserExistsCache;
  }
  const proc = new Deno.Command("getent", {
    args: ["passwd", TURBOPANEL_USER],
    stdout: "null",
    stderr: "null",
  });
  turbopanelUserExistsCache = (await proc.output()).success;
  return turbopanelUserExistsCache;
}

async function runGitInherit(gitArgs: string[]): Promise<number> {
  if (await turbopanelUserExists()) {
    return runInherit(["sudo", "-u", TURBOPANEL_USER, "git", ...gitArgs]);
  }
  return runInherit(["git", ...gitArgs]);
}

async function runGitCapture(
  gitArgs: string[],
): Promise<{ success: boolean; code: number; stdout: string; stderr: string }> {
  const proc = await turbopanelUserExists()
    ? new Deno.Command("sudo", {
      args: ["-u", TURBOPANEL_USER, "git", ...gitArgs],
      stdout: "piped",
      stderr: "piped",
    })
    : new Deno.Command("git", {
      args: gitArgs,
      stdout: "piped",
      stderr: "piped",
    });
  const output = await proc.output();
  return {
    success: output.success,
    code: output.code ?? 1,
    stdout: new TextDecoder().decode(output.stdout).trim(),
    stderr: new TextDecoder().decode(output.stderr).trim(),
  };
}

async function commandExists(name: string): Promise<boolean> {
  const proc = new Deno.Command("/bin/sh", {
    args: ["-c", 'command -v "$1" >/dev/null 2>&1', "_", name],
    stdout: "null",
    stderr: "null",
  });
  return (await proc.output()).success;
}

export async function runInherit(cmd: string[]): Promise<number> {
  const proc = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return (await proc.output()).code ?? 1;
}

function canWritePath(path: string): boolean {
  try {
    Deno.mkdirSync(path, { recursive: true });
    const probe = `${path}/.write-probe-${Deno.pid}`;
    Deno.writeTextFileSync(probe, "");
    Deno.removeSync(probe);
    return true;
  } catch {
    return false;
  }
}

function canWritePlatformDir(): boolean {
  return canWritePath(TURBOPANEL_PLATFORM);
}

async function ensurePlatformDir(): Promise<void> {
  if (canWritePlatformDir()) {
    return;
  }

  console.log(`→ Administrator privileges required for ${TURBOPANEL_PLATFORM}`);

  const code = await runInherit([
    "sudo",
    "sh",
    "-c",
    `mkdir -p '${TURBOPANEL_PLATFORM}'`,
  ]);

  if (code !== 0) {
    throw new Error(`Failed to create ${TURBOPANEL_PLATFORM}`);
  }
}

function daemonCheckoutExists(target: string): boolean {
  try {
    Deno.statSync(target);
    return true;
  } catch {
    return false;
  }
}

function canManageDaemonCheckout(target: string): boolean {
  if (!daemonCheckoutExists(target)) {
    return canWritePath(TURBOPANEL_PLATFORM);
  }

  return canWritePath(target);
}

async function ensureTurbopanelOwnership(target: string): Promise<void> {
  if (!(await turbopanelUserExists())) {
    return;
  }

  const code = await runInherit([
    "sudo",
    "sh",
    "-c",
    `chown -R '${TURBOPANEL_USER}:${TURBOPANEL_GROUP}' '${target}'`,
  ]);

  if (code !== 0) {
    throw new Error(`Failed to set ownership on ${target}`);
  }
}

async function privilegedClone(
  url: string,
  target: string,
): Promise<number> {
  const tmpDir = `/tmp/turbopanel-daemon-clone-${crypto.randomUUID()}`;

  const cloneCode = await runInherit([
    "git",
    "clone",
    "--branch",
    BRANCH,
    url,
    tmpDir,
  ]);
  if (cloneCode !== 0) {
    return cloneCode;
  }

  const chownStep = (await turbopanelUserExists())
    ? ` && chown -R '${TURBOPANEL_USER}:${TURBOPANEL_GROUP}' '${target}'`
    : "";

  return await runInherit([
    "sudo",
    "sh",
    "-c",
    `mkdir -p '${TURBOPANEL_PLATFORM}' && rm -rf '${target}' && mv '${tmpDir}' '${target}'${chownStep}`,
  ]);
}

async function ensureGit(): Promise<void> {
  if (await commandExists("git")) {
    return;
  }

  console.log("→ git not found — installing");
  const code = await runInherit([
    "sudo",
    "sh",
    "-c",
    "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y git",
  ]);

  if (code !== 0 || !(await commandExists("git"))) {
    throw new Error("Failed to install git");
  }
}

async function isGitRepo(path: string): Promise<boolean> {
  const result = await runGitCapture(["-C", path, "rev-parse", "--git-dir"]);
  return result.success;
}

async function hasUncommittedChanges(path: string): Promise<boolean> {
  const result = await runGitCapture(["-C", path, "status", "--porcelain"]);
  if (!result.success) {
    return true;
  }
  return result.stdout.length > 0;
}

async function ensureOriginUrl(path: string, url: string): Promise<void> {
  const result = await runGitCapture(["-C", path, "remote", "get-url", "origin"]);
  if (!result.success) {
    return;
  }

  if (result.stdout === url) {
    return;
  }

  await runGitInherit(["-C", path, "remote", "set-url", "origin", url]);
}

async function cloneOrUpdateRepo(
  dir: string,
  repo: string,
): Promise<"cloned" | "updated" | "skipped"> {
  const target = platformRepoPath(dir);
  const url = sshRepoUrl(repo);

  if (!daemonCheckoutExists(target)) {
    console.log(`→ Cloning ${dir}...`);
    const code = canManageDaemonCheckout(target)
      ? await runInherit([
        "git",
        "clone",
        "--branch",
        BRANCH,
        url,
        target,
      ])
      : await privilegedClone(url, target);
    if (code !== 0) {
      throw new Error(`Failed to clone ${dir}`);
    }
    if (canManageDaemonCheckout(target)) {
      await ensureTurbopanelOwnership(target);
    }
    console.log(`✓ Cloned ${dir}`);
    return "cloned";
  }

  if (!(await isGitRepo(target))) {
    throw new Error(`${target} exists but is not a git repository`);
  }

  await ensureOriginUrl(target, url);

  if (await hasUncommittedChanges(target)) {
    console.log(`⚠ ${dir} has uncommitted changes — skipped`);
    return "skipped";
  }

  console.log(`→ Updating ${dir}...`);
  const code = await runGitInherit([
    "-C",
    target,
    "pull",
    "--ff-only",
    "origin",
    BRANCH,
  ]);
  if (code !== 0) {
    throw new Error(`Failed to update ${dir}`);
  }
  console.log(`✓ Updated ${dir}`);
  return "updated";
}

export async function installDaemon(): Promise<void> {
  await ensureGit();
  await ensurePlatformDir();

  const { dir, repo } = DAEMON_REPO;
  await cloneOrUpdateRepo(dir, repo);

  console.log("");
  console.log("✓ Daemon repository ready");
  console.log(`  ${platformRepoPath(dir)}/`);
  console.log("");
  console.log("Run ./console to return to the console.");
}

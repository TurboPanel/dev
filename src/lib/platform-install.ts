import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  DAEMON_REPO,
  platformRepoPath,
  sshRepoUrl,
  TURBOPANEL_PLATFORM,
  TURBOPANEL_TRUNK_BRANCH,
} from "./paths.ts";
import {
  type InstallOutputHandler,
  runCaptured,
} from "./install-output.ts";
import { ensureTurbopanelGithubAccess } from "./turbopanel-github-access.ts";


const TURBOPANEL_USER = "turbopanel";
const TURBOPANEL_GROUP = "turbopanel";

let turbopanelUserExistsCache: boolean | null = null;

export type InstallStepHandler = (
  label: string,
  status: "running" | "ok" | "failed",
) => void;

function turbopanelUserExists(): boolean {
  if (turbopanelUserExistsCache !== null) {
    return turbopanelUserExistsCache;
  }
  const result = spawnSync("getent", ["passwd", TURBOPANEL_USER], {
    stdio: "ignore",
  });
  turbopanelUserExistsCache = result.status === 0;
  return turbopanelUserExistsCache;
}

function commandExists(name: string): boolean {
  const result = spawnSync(
    "/bin/sh",
    ["-c", 'command -v "$1" >/dev/null 2>&1', "_", name],
    { stdio: "ignore" },
  );
  return result.status === 0;
}

async function runInherit(cmd: string[], onOutput?: InstallOutputHandler): Promise<number> {
  return runCaptured(cmd, onOutput);
}

async function runGitInherit(
  gitArgs: string[],
  onOutput?: InstallOutputHandler,
): Promise<number> {
  if (turbopanelUserExists()) {
    return runInherit(["sudo", "-u", TURBOPANEL_USER, "git", ...gitArgs], onOutput);
  }
  return runInherit(["git", ...gitArgs], onOutput);
}

function runGitCapture(gitArgs: string[]): {
  success: boolean;
  stdout: string;
  stderr: string;
} {
  const cmd = turbopanelUserExists()
    ? ["sudo", "-u", TURBOPANEL_USER, "git", ...gitArgs]
    : ["git", ...gitArgs];
  const result = spawnSync(cmd[0], cmd.slice(1), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    success: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function canWritePath(path: string): boolean {
  try {
    mkdirSync(path, { recursive: true });
    const probe = `${path}/.write-probe-${process.pid}`;
    writeFileSync(probe, "");
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function canWritePlatformDir(): boolean {
  return canWritePath(TURBOPANEL_PLATFORM);
}

function daemonCheckoutExists(target: string): boolean {
  return existsSync(target);
}

function canManageDaemonCheckout(target: string): boolean {
  if (!daemonCheckoutExists(target)) {
    return canWritePath(TURBOPANEL_PLATFORM);
  }

  return canWritePath(target);
}

async function ensureTurbopanelOwnership(
  target: string,
  onOutput?: InstallOutputHandler,
): Promise<void> {
  if (!turbopanelUserExists()) {
    return;
  }

  const code = await runInherit([
    "sudo",
    "sh",
    "-c",
    `chown -R '${TURBOPANEL_USER}:${TURBOPANEL_GROUP}' '${target}'`,
  ], onOutput);

  if (code !== 0) {
    throw new Error(`Failed to set ownership on ${target}`);
  }
}

async function privilegedClone(
  url: string,
  target: string,
  onOutput?: InstallOutputHandler,
): Promise<number> {
  const tmpDir = `/tmp/turbopanel-daemon-clone-${randomUUID()}`;

  const cloneCode = await runInherit([
    "git",
    "clone",
    "--branch",
    TURBOPANEL_TRUNK_BRANCH,
    url,
    tmpDir,
  ], onOutput);
  if (cloneCode !== 0) {
    return cloneCode;
  }

  const chownStep = turbopanelUserExists()
    ? ` && chown -R '${TURBOPANEL_USER}:${TURBOPANEL_GROUP}' '${target}'`
    : "";

  return runInherit([
    "sudo",
    "sh",
    "-c",
    `mkdir -p '${TURBOPANEL_PLATFORM}' && rm -rf '${target}' && mv '${tmpDir}' '${target}'${chownStep}`,
  ], onOutput);
}

function isGitRepo(path: string): boolean {
  return runGitCapture(["-C", path, "rev-parse", "--git-dir"]).success;
}

function hasUncommittedChanges(path: string): boolean {
  const result = runGitCapture(["-C", path, "status", "--porcelain"]);
  if (!result.success) {
    return true;
  }
  return result.stdout.length > 0;
}

async function ensureOriginUrl(
  path: string,
  url: string,
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const result = runGitCapture(["-C", path, "remote", "get-url", "origin"]);
  if (!result.success) {
    return;
  }

  if (result.stdout === url) {
    return;
  }

  await runGitInherit(["-C", path, "remote", "set-url", "origin", url], onOutput);
}

async function ensureGit(
  onStep?: InstallStepHandler,
  onOutput?: InstallOutputHandler,
): Promise<void> {
  if (commandExists("git")) {
    return;
  }

  onStep?.("Install git", "running");
  const code = await runInherit([
    "sudo",
    "sh",
    "-c",
    "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y git",
  ], onOutput);

  if (code !== 0 || !commandExists("git")) {
    onStep?.("Install git", "failed");
    throw new Error("Failed to install git");
  }
  onStep?.("Install git", "ok");
}

async function ensurePlatformDir(
  onStep?: InstallStepHandler,
  onOutput?: InstallOutputHandler,
): Promise<void> {
  if (canWritePlatformDir()) {
    return;
  }

  const label = `Create ${TURBOPANEL_PLATFORM}`;
  onStep?.(label, "running");

  const code = await runInherit([
    "sudo",
    "sh",
    "-c",
    `mkdir -p '${TURBOPANEL_PLATFORM}'`,
  ], onOutput);

  if (code !== 0) {
    onStep?.(label, "failed");
    throw new Error(`Failed to create ${TURBOPANEL_PLATFORM}`);
  }
  onStep?.(label, "ok");
}

async function cloneOrUpdateRepo(
  dir: string,
  repo: string,
  onStep?: InstallStepHandler,
  onOutput?: InstallOutputHandler,
): Promise<"cloned" | "updated" | "skipped"> {
  const target = platformRepoPath(dir);
  const url = sshRepoUrl(repo);

  if (!daemonCheckoutExists(target)) {
    onStep?.(`Clone ${dir}`, "running");
    const code = canManageDaemonCheckout(target)
      ? await runInherit(["git", "clone", "--branch", TURBOPANEL_TRUNK_BRANCH, url, target], onOutput)
      : await privilegedClone(url, target, onOutput);
    if (code !== 0) {
      onStep?.(`Clone ${dir}`, "failed");
      throw new Error(`Failed to clone ${dir}`);
    }
    if (canManageDaemonCheckout(target)) {
      await ensureTurbopanelOwnership(target, onOutput);
    }
    onStep?.(`Clone ${dir}`, "ok");
    return "cloned";
  }

  if (!isGitRepo(target)) {
    throw new Error(`${target} exists but is not a git repository`);
  }

  await ensureOriginUrl(target, url, onOutput);

  if (hasUncommittedChanges(target)) {
    onStep?.(`Update ${dir} (skipped — uncommitted changes)`, "ok");
    return "skipped";
  }

  onStep?.(`Update ${dir}`, "running");
  const code = await runGitInherit([
    "-C",
    target,
    "pull",
    "--ff-only",
    "origin",
    TURBOPANEL_TRUNK_BRANCH,
  ], onOutput);
  if (code !== 0) {
    onStep?.(`Update ${dir}`, "failed");
    throw new Error(`Failed to update ${dir}`);
  }
  onStep?.(`Update ${dir}`, "ok");
  return "updated";
}

export async function installDaemon(
  onStep?: InstallStepHandler,
  onOutput?: InstallOutputHandler,
): Promise<void> {
  await ensureGit(onStep, onOutput);
  await ensurePlatformDir(onStep, onOutput);

  if (turbopanelUserExists()) {
    await ensureTurbopanelGithubAccess(onOutput);
  }

  const { dir, repo } = DAEMON_REPO;
  await cloneOrUpdateRepo(dir, repo, onStep, onOutput);
  onStep?.("Daemon repository ready", "ok");
}

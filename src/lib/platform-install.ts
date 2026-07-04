import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  DAEMON_REPO,
  platformRepoPath,
  sshRepoUrl,
  TURBOPANEL_TRUNK_BRANCH,
} from "./paths.ts";
import { aptGetInstall } from "./apt.ts";
import {
  type InstallOutputHandler,
  runCaptured,
} from "./install-output.ts";

export type InstallStepHandler = (
  label: string,
  status: "running" | "ok" | "failed",
) => void;

function commandExists(name: string): boolean {
  const result = spawnSync(
    "/bin/sh",
    ["-c", 'command -v "$1" >/dev/null 2>&1', "_", name],
    { stdio: "ignore" },
  );
  return result.status === 0;
}

async function runGit(
  gitArgs: string[],
  onOutput?: InstallOutputHandler,
): Promise<number> {
  return runCaptured(["git", ...gitArgs], onOutput);
}

function runGitCapture(gitArgs: string[]): {
  success: boolean;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync("git", gitArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    success: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function daemonCheckoutExists(target: string): boolean {
  return existsSync(target);
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

  await runGit(["-C", path, "remote", "set-url", "origin", url], onOutput);
}

async function ensureGit(
  onStep?: InstallStepHandler,
  onOutput?: InstallOutputHandler,
): Promise<void> {
  if (commandExists("git")) {
    return;
  }

  onStep?.("Install git", "running");
  const code = await aptGetInstall(["git"], onOutput, { update: true });

  if (code !== 0 || !commandExists("git")) {
    onStep?.("Install git", "failed");
    throw new Error("Failed to install git");
  }
  onStep?.("Install git", "ok");
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
    // The checkout lives under the dev user's home, which the dev user owns —
    // create the parent and clone directly (no sudo/service-user dance).
    mkdirSync(dirname(target), { recursive: true });
    const code = await runGit(
      ["clone", "--branch", TURBOPANEL_TRUNK_BRANCH, url, target],
      onOutput,
    );
    if (code !== 0) {
      onStep?.(`Clone ${dir}`, "failed");
      throw new Error(`Failed to clone ${dir}`);
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
  const code = await runGit(
    ["-C", target, "pull", "--ff-only", "origin", TURBOPANEL_TRUNK_BRANCH],
    onOutput,
  );
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

  const { dir, repo } = DAEMON_REPO;
  await cloneOrUpdateRepo(dir, repo, onStep, onOutput);
  onStep?.("Daemon repository ready", "ok");
}

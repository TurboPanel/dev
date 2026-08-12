import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  ALL_DEV_CHECKOUT_DIRS,
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
import { spawnSyncTrusted, spawnSyncTrustedText } from "./spawn-trusted.ts";

export type InstallStepHandler = (
  label: string,
  status: "running" | "ok" | "failed",
) => void;

function commandExists(name: string): boolean {
  const result = spawnSyncTrusted(
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
  const result = spawnSyncTrustedText("git", gitArgs, {
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

/**
 * True when `target` looks like a runnable daemon source tree.
 *
 * Matches the daemon's `detectInstallMode()` markers (`main.ts` or
 * `orchestration/ansible.cfg`). Used so Vagrant VirtFS mounts (and other
 * host-managed checkouts) can be accepted without requiring a working `.git`
 * directory — guest Git often rejects those mounts via `safe.directory`.
 */
export function isUsableDaemonCheckout(target: string): boolean {
  return (
    existsSync(`${target}/main.ts`) ||
    existsSync(`${target}/orchestration/ansible.cfg`)
  );
}

function isGitRepo(path: string): boolean {
  return runGitCapture(["-C", path, "rev-parse", "--git-dir"]).success;
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

function ensureRepoGitHooksPath(
  target: string,
  onStep?: InstallStepHandler,
): void {
  const hook = `${target}/.githooks/pre-commit`;
  if (!existsSync(hook)) {
    return;
  }

  if (!isGitRepo(target)) {
    return;
  }

  onStep?.(`Wire git hooksPath (${target})`, "running");
  const current = runGitCapture([
    "-C",
    target,
    "config",
    "--local",
    "--get",
    "core.hooksPath",
  ]);
  if (current.stdout !== ".githooks") {
    const result = runGitCapture([
      "-C",
      target,
      "config",
      "--local",
      "core.hooksPath",
      ".githooks",
    ]);
    if (!result.success) {
      onStep?.(`Wire git hooksPath (${target})`, "failed");
      throw new Error(`Failed to set core.hooksPath in ${target}`);
    }
  }
  chmodSync(hook, 0o755);
  onStep?.(`Wire git hooksPath (${target})`, "ok");
}

/** Idempotently wire .githooks for every present development checkout. */
export function ensureAllGitHooksPaths(onStep?: InstallStepHandler): void {
  for (const dir of ALL_DEV_CHECKOUT_DIRS) {
    ensureRepoGitHooksPath(platformRepoPath(dir), onStep);
  }
}

/**
 * Ensure the daemon source checkout is present and usable.
 *
 * - Missing path → clone (bare-metal / first-time hosts without a sibling tree).
 * - Existing usable tree → use as-is. Vagrant VirtFS mounts and pre-cloned
 *   siblings are the source of truth; do not clone or pull from the guest.
 *   Guest Git may also refuse mounted trees via `safe.directory`, so a working
 *   `.git` is not required when the tree already looks like the daemon.
 */
async function ensureDaemonCheckout(
  dir: string,
  repo: string,
  onStep?: InstallStepHandler,
  onOutput?: InstallOutputHandler,
): Promise<"cloned" | "present"> {
  const target = platformRepoPath(dir);

  if (daemonCheckoutExists(target)) {
    if (!isUsableDaemonCheckout(target)) {
      throw new Error(
        `${target} exists but is not a usable daemon checkout (expected main.ts or orchestration/ansible.cfg)`,
      );
    }
    ensureRepoGitHooksPath(target, onStep);
    onStep?.(`Use existing ${dir} checkout`, "ok");
    return "present";
  }

  onStep?.(`Clone ${dir}`, "running");
  // The checkout lives under the dev user's home, which the dev user owns —
  // create the parent and clone directly (no sudo/service-user dance).
  mkdirSync(dirname(target), { recursive: true });
  const code = await runGit(
    ["clone", "--branch", TURBOPANEL_TRUNK_BRANCH, sshRepoUrl(repo), target],
    onOutput,
  );
  if (code !== 0) {
    onStep?.(`Clone ${dir}`, "failed");
    throw new Error(`Failed to clone ${dir}`);
  }
  onStep?.(`Clone ${dir}`, "ok");
  ensureRepoGitHooksPath(target, onStep);
  return "cloned";
}

export async function installDaemon(
  onStep?: InstallStepHandler,
  onOutput?: InstallOutputHandler,
): Promise<void> {
  await ensureGit(onStep, onOutput);

  const { dir, repo } = DAEMON_REPO;
  await ensureDaemonCheckout(dir, repo, onStep, onOutput);
  ensureAllGitHooksPaths(onStep);
  onStep?.("Daemon repository ready", "ok");
}

import { existsSync } from "node:fs";
import {
  installDevEnvironment,
  type InstallDevEnvironmentDeps,
} from "./instance-install.ts";
import {
  type InstallOutputHandler,
  runCaptured,
} from "./install-output.ts";
import {
  PLATFORM_DOCKER_CONTAINER_NAMES,
  PLATFORM_DOCKER_VOLUME_NAMES,
} from "./platform-docker-resources.ts";
import type { InstallStepHandler } from "./platform-install.ts";
import {
  DAEMON_SYSTEMD_UNIT,
  platformRepoPath,
  TURBOPANEL_TRUNK_BRANCH,
} from "./paths.ts";
import { shellQuote } from "./shell-quote.ts";

const PLATFORM_REPOS = ["turbopaneld", "turbopanel", "ui", "website"] as const;

async function runShellStep(
  label: string,
  command: string,
  onOutput: InstallOutputHandler | undefined,
  onStep: InstallStepHandler,
  sudoArgs: string[] = ["sudo", "-n", "bash", "-c"],
): Promise<void> {
  onStep(label, "running");
  const code = await runCaptured([...sudoArgs, command], onOutput);
  if (code !== 0) {
    onStep(label, "failed");
    throw new Error(`Step failed: ${label}`);
  }
  onStep(label, "ok");
}

async function resetRepo(
  repo: string,
  onOutput: InstallOutputHandler | undefined,
  onStep: InstallStepHandler,
): Promise<void> {
  const label = `Reset repo: ${repo}`;
  const repoPath = platformRepoPath(repo);

  if (!existsSync(repoPath)) {
    return;
  }

  const quotedPath = shellQuote(repoPath);
  const command =
    `git -C ${quotedPath} fetch --all && git -C ${quotedPath} reset --hard origin/${TURBOPANEL_TRUNK_BRANCH}`;

  onStep(label, "running");
  // The checkout is dev-owned; run git directly as the invoking dev user.
  const code = await runCaptured(["bash", "-c", command], onOutput);
  if (code !== 0) {
    onStep(label, "failed");
    throw new Error(`Step failed: ${label}`);
  }
  onStep(label, "ok");
}

/** Injectable collaborators for {@link resetDevEnvironment} (tests). */
export type ResetDevEnvironmentDeps = {
  runShellStep: typeof runShellStep;
  resetRepo: typeof resetRepo;
  installDevEnvironment: (
    onEvent: (event: unknown) => void,
    onOutput?: InstallOutputHandler,
    onStep?: InstallStepHandler,
    deps?: InstallDevEnvironmentDeps,
    mode?: "if-needed" | "force",
  ) => Promise<void>;
};

const defaultResetDevEnvironmentDeps: ResetDevEnvironmentDeps = {
  runShellStep,
  resetRepo,
  installDevEnvironment,
};

export async function resetDevEnvironment(
  onOutput: InstallOutputHandler,
  onStep: InstallStepHandler,
  deps: ResetDevEnvironmentDeps = defaultResetDevEnvironmentDeps,
): Promise<void> {
  const containerNames = PLATFORM_DOCKER_CONTAINER_NAMES.join(" ");
  const volumeNames = PLATFORM_DOCKER_VOLUME_NAMES.join(" ");

  await deps.runShellStep(
    "Stop platform services",
    `systemctl stop turbopanel-instance turbopanel-caddy turbopanel-ui turbopanel-website turbopanel-mailer turbopanel-system-stack turbopanel-mailpit turbopanel-redis-insight turbopanel-redis turbopanel-tabix ${DAEMON_SYSTEMD_UNIT} 2>/dev/null || true`,
    onOutput,
    onStep,
  );

  await deps.runShellStep(
    "Remove Docker containers",
    `docker rm -f ${containerNames} 2>/dev/null || true`,
    onOutput,
    onStep,
  );

  await deps.runShellStep(
    "Remove Docker volumes",
    `docker volume rm ${volumeNames} 2>/dev/null || true`,
    onOutput,
    onStep,
  );

  for (const repo of PLATFORM_REPOS) {
    await deps.resetRepo(repo, onOutput, onStep);
  }

  // Always force-rebuild after teardown — `"if-needed"` would honor a stale
  // converge stamp and exit without recreating the stack.
  await deps.installDevEnvironment(() => {}, onOutput, onStep, undefined, "force");
}

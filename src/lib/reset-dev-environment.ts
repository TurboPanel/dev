import { existsSync } from "node:fs";
import { installDevEnvironment } from "./instance-install.ts";
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

const PLATFORM_REPOS = ["daemon", "instance", "ui", "website"] as const;

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

export async function resetDevEnvironment(
  onOutput: InstallOutputHandler,
  onStep: InstallStepHandler,
): Promise<void> {
  const containerNames = PLATFORM_DOCKER_CONTAINER_NAMES.join(" ");
  const volumeNames = PLATFORM_DOCKER_VOLUME_NAMES.join(" ");

  await runShellStep(
    "Stop platform services",
    `systemctl stop turbopanel-instance turbopanel-caddy turbopanel-ui turbopanel-website turbopanel-mailer turbopanel-rabbitmq turbopanel-mailpit turbopanel-redis-insight turbopanel-redis turbopanel-clickhouse turbopanel-tabix ${DAEMON_SYSTEMD_UNIT} 2>/dev/null || true`,
    onOutput,
    onStep,
  );

  await runShellStep(
    "Remove Docker containers",
    `docker rm -f ${containerNames} 2>/dev/null || true`,
    onOutput,
    onStep,
  );

  await runShellStep(
    "Remove Docker volumes",
    `docker volume rm ${volumeNames} 2>/dev/null || true`,
    onOutput,
    onStep,
  );

  for (const repo of PLATFORM_REPOS) {
    await resetRepo(repo, onOutput, onStep);
  }

  await installDevEnvironment(() => {}, onOutput, onStep);
}

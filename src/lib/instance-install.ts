import { spawn } from "node:child_process";
import { writeDaemonEnv } from "./daemon-env.ts";
import { requestDaemonRestart } from "./daemon-actions.ts";
import { orchestrationActionCommand } from "./daemon-exec.ts";
import { resolveDevIdentity } from "./dev-identity.ts";
import {
  ANSIBLE_COLLECTIONS_PATH,
  DAEMON_REPO_DIR,
  PYTHON_INSTALL_DIR,
  RUNTIMES_DIR,
  TURBOPANEL_ROOT,
  UV_CACHE_DIR,
} from "./paths.ts";
import type { InstallStepHandler } from "./platform-install.ts";
import {
  captureChildEnv,
  type InstallOutputHandler,
  runCaptured,
  sanitizeInstallOutput,
} from "./install-output.ts";
import { ensureTurbopanelGithubAccess } from "./turbopanel-github-access.ts";
import {
  ensureDaemonSystemdDockerAccess,
  ensureDevPlatformAccess,
  ensureDevUserDockerAccess,
  ensurePlatformCheckoutGroupAccess,
  ensureTurbopanelStateOwnership,
  resetTurbopanelUserCache,
  turbopanelUserExists,
} from "./turbopanel-permissions.ts";

const TURBOPANEL_USER = "turbopanel";
const TURBOPANEL_GROUP = "turbopanel";
const DAEMON_DIR = DAEMON_REPO_DIR;

async function ensureDaemonGitMetadataForAnsible(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const code = await runCaptured(
    [
      "sudo",
      "-n",
      "bash",
      "-c",
      `chown -R '${TURBOPANEL_USER}:${TURBOPANEL_GROUP}' '${DAEMON_DIR}/.git' 2>/dev/null || true`,
    ],
    onOutput,
  );
  if (code !== 0) {
    throw new Error("Failed to reclaim daemon .git metadata for Ansible git tasks");
  }
}

export const DEV_ENV_CONVERGE_STEP = "Converge development environment (Ansible)";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function orchestrationEnv(): string[] {
  const dev = resolveDevIdentity();
  return [
    `HOME=${TURBOPANEL_ROOT}`,
    `ANSIBLE_COLLECTIONS_PATH=${ANSIBLE_COLLECTIONS_PATH}`,
    `UV_PYTHON_INSTALL_DIR=${PYTHON_INSTALL_DIR}`,
    `UV_CACHE_DIR=${UV_CACHE_DIR}`,
    `TURBOPANEL_DEV_USER=${dev.user}`,
    `TURBOPANEL_DEV_UID=${dev.uid}`,
    `TURBOPANEL_DEV_GID=${dev.gid}`,
    "UV_NO_MODIFY_PATH=1",
    "UV_PYTHON_DOWNLOADS=automatic",
    "UV_VENV_CLEAR=1",
  ];
}

function orchestrationSudoArgs(command: string): string[] {
  const envArgs = ["env", ...orchestrationEnv(), "bash", "-c", command];
  if (turbopanelUserExists()) {
    return ["-n", "-u", TURBOPANEL_USER, ...envArgs];
  }
  return ["-n", ...envArgs];
}

async function runOrchestrationAction(
  actionArgs: string[],
  onEvent: (event: unknown) => void,
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const invocation = orchestrationActionCommand(...actionArgs);
  const command = `cd ${shellQuote(DAEMON_DIR)} && exec ${invocation}`;
  const args = orchestrationSudoArgs(command);

  await new Promise<void>((resolve, reject) => {
    const child = spawn("sudo", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: captureChildEnv(),
      detached: false,
    });

    let stdoutBuffer = "";
    let stdoutTail = "";
    let stderrBuffer = "";
    let stderrTail = "";

    const handleLine = (line: string) => {
      const trimmed = sanitizeInstallOutput(line).trim();
      if (trimmed.length === 0) return;
      stdoutTail = trimmed;
      try {
        onEvent(JSON.parse(trimmed));
      } catch {
        onOutput?.(trimmed);
      }
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      let newline = stdoutBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline);
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        handleLine(line);
        newline = stdoutBuffer.indexOf("\n");
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderrBuffer += text;
      const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        stderrTail = line;
        onOutput?.(line);
      }
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (stdoutBuffer.trim().length > 0) {
        handleLine(stdoutBuffer);
      }
      if (code === 0) {
        resolve();
        return;
      }

      if (!stderrTail && stderrBuffer.trim().length > 0) {
        const lines = stderrBuffer
          .trim()
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length > 0) {
          stderrTail = lines[lines.length - 1]!;
        }
      }

      const message = stderrTail || stdoutTail || "Orchestration action failed";
      reject(new Error(message));
    });
  });
}

export async function installDevEnvironment(
  onEvent: (event: unknown) => void,
  onOutput?: InstallOutputHandler,
  onStep?: InstallStepHandler,
): Promise<void> {
  await ensureDevPlatformAccess(onOutput);
  if (turbopanelUserExists()) {
    await ensureTurbopanelStateOwnership(onOutput);
    await ensureTurbopanelGithubAccess(onOutput);
    await ensureDaemonGitMetadataForAnsible(onOutput);
    writeDaemonEnv();
  }

  onStep?.(DEV_ENV_CONVERGE_STEP, "running");
  try {
    await runOrchestrationAction(["instance-dev-install"], onEvent, onOutput);
    onStep?.(DEV_ENV_CONVERGE_STEP, "ok");
  } catch (error) {
    onStep?.(DEV_ENV_CONVERGE_STEP, "failed");
    throw error;
  }

  await ensurePlatformCheckoutGroupAccess(onOutput);
  await ensureDevUserDockerAccess(onOutput);
  await requestDaemonRestart(onOutput);

  const dockerAccessChanged = await ensureDaemonSystemdDockerAccess(onOutput);
  if (dockerAccessChanged) {
    await requestDaemonRestart(onOutput);
  }

  resetTurbopanelUserCache();
  await ensureDevPlatformAccess(onOutput);
  if (turbopanelUserExists()) {
    await ensureTurbopanelStateOwnership(onOutput);
  }
}

import { spawn } from "node:child_process";
import { writeDaemonInstanceEnv } from "./daemon-env.ts";
import {
  enableAndStartDaemon,
  isDaemonServiceActive,
  requestDaemonRestart,
} from "./daemon-actions.ts";
import { installDaemonSystemd } from "./daemon-install.ts";
import { orchestrationActionCommand } from "./daemon-exec.ts";
import { isDaemonSystemdInstalled } from "../dev-services.ts";
import { resolveDevIdentity } from "./dev-identity.ts";
import {
  daemonRepoPath,
  devOrchestrationDir,
  PYTHON_RUNTIME_DIR,
  resolveDevRoot,
  UV_CACHE_DIR,
} from "./paths.ts";
import type { InstallStepHandler } from "./platform-install.ts";
import {
  captureChildEnv,
  type InstallOutputHandler,
  sanitizeInstallOutput,
} from "./install-output.ts";
import { TRUSTED_SYSTEM_PATH } from "./spawn-trusted.ts";
import { ensureDevUserDockerAccess } from "./turbopanel-permissions.ts";
import { shellQuote } from "./shell-quote.ts";

const DAEMON_DIR = daemonRepoPath();

export const DEV_ENV_CONVERGE_STEP = "Converge development environment (Ansible)";

function collectAnsibleHostMessages(hosts: unknown): string[] {
  if (typeof hosts !== "object" || hosts === null) {
    return [];
  }

  const messages: string[] = [];
  for (const result of Object.values(hosts as Record<string, Record<string, unknown>>)) {
    const msg = result.msg;
    if (typeof msg === "string" && msg.length > 0) {
      messages.push(msg);
    }
  }
  return messages;
}

function extractAnsibleTaskName(task: unknown): string | undefined {
  if (typeof task !== "object" || task === null) {
    return undefined;
  }
  return (task as { name?: string }).name?.trim();
}

function extractAnsibleFailureMessage(event: unknown): string | null {
  if (typeof event !== "object" || event === null) {
    return null;
  }

  const record = event as Record<string, unknown>;
  if (record._event !== "v2_runner_on_failed" && record._event !== "v2_runner_on_unreachable") {
    return null;
  }

  const detail = collectAnsibleHostMessages(record.hosts).join("; ");
  const taskName = extractAnsibleTaskName(record.task);
  if (taskName && detail) {
    return `${taskName}: ${detail}`;
  }
  return taskName || detail || "Ansible task failed";
}

function lastNonEmptyLine(buffer: string): string | undefined {
  const lines = buffer
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.at(-1);
}

function orchestrationEnv(): string[] {
  const dev = resolveDevIdentity();
  const devRoot = resolveDevRoot();
  return [
    `UV_PYTHON_INSTALL_DIR=${PYTHON_RUNTIME_DIR}`,
    `UV_CACHE_DIR=${UV_CACHE_DIR}`,
    `TURBOPANEL_DEV_USER=${dev.user}`,
    `TURBOPANEL_DEV_UID=${dev.uid}`,
    `TURBOPANEL_DEV_GID=${dev.gid}`,
    `TURBOPANEL_DEV_ROOT=${devRoot}`,
    `TURBOPANEL_DEV_ORCHESTRATION_DIR=${devOrchestrationDir()}`,
    "UV_NO_MODIFY_PATH=1",
    "UV_PYTHON_DOWNLOADS=automatic",
    "UV_VENV_CLEAR=1",
  ];
}

export async function runOrchestrationAction(
  actionArgs: string[],
  onEvent: (event: unknown) => void,
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const invocation = orchestrationActionCommand(...actionArgs);
  const command = `cd ${shellQuote(DAEMON_DIR)} && exec ${invocation}`;
  let lastFailureMessage: string | null = null;

  const trackEvent = (event: unknown) => {
    const failureMessage = extractAnsibleFailureMessage(event);
    if (failureMessage) {
      lastFailureMessage = failureMessage;
    }
    onEvent(event);
  };

  await new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/env", [...orchestrationEnv(), "/bin/bash", "-c", command], {
      stdio: ["ignore", "pipe", "pipe"],
      env: captureChildEnv({ PATH: TRUSTED_SYSTEM_PATH }),
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
        trackEvent(JSON.parse(trimmed));
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
        stderrTail = lastNonEmptyLine(stderrBuffer) ?? stderrTail;
      }

      const message = lastFailureMessage || stderrTail || stdoutTail || "Orchestration action failed";
      reject(new Error(message));
    });
  });
}

/** Injectable collaborators for {@link installDevEnvironment} (tests). */
export type InstallDevEnvironmentDeps = {
  ensureDevUserDockerAccess: (
    onOutput?: InstallOutputHandler,
  ) => Promise<boolean>;
  runOrchestrationAction: (
    actionArgs: string[],
    onEvent: (event: unknown) => void,
    onOutput?: InstallOutputHandler,
  ) => Promise<void>;
  writeDaemonInstanceEnv: () => void;
  isDaemonSystemdInstalled: () => boolean;
  installDaemonSystemd: (
    onOutput?: InstallOutputHandler,
    onStep?: InstallStepHandler,
  ) => Promise<void>;
  isDaemonServiceActive: () => boolean;
  requestDaemonRestart: (onOutput?: InstallOutputHandler) => Promise<void>;
  enableAndStartDaemon: (onOutput?: InstallOutputHandler) => Promise<void>;
};

const defaultInstallDevEnvironmentDeps: InstallDevEnvironmentDeps = {
  ensureDevUserDockerAccess,
  runOrchestrationAction,
  writeDaemonInstanceEnv,
  isDaemonSystemdInstalled,
  installDaemonSystemd,
  isDaemonServiceActive,
  requestDaemonRestart,
  enableAndStartDaemon,
};

export async function installDevEnvironment(
  onEvent: (event: unknown) => void,
  onOutput?: InstallOutputHandler,
  onStep?: InstallStepHandler,
  deps: InstallDevEnvironmentDeps = defaultInstallDevEnvironmentDeps,
): Promise<void> {
  // Pre-converge: best-effort docker group membership. Ansible's converge is
  // authoritative for FHS/checkout ownership and docker membership.
  //
  // Do NOT write TURBOPANEL_DEV_INSTANCE until Ansible succeeds — writing it
  // first leaves a failed converge with docker-monitor enabled and no stack,
  // which looks like the daemon is "stuck waiting for Docker" with nothing
  // installing.
  await deps.ensureDevUserDockerAccess(onOutput);

  onStep?.(DEV_ENV_CONVERGE_STEP, "running");
  try {
    await deps.runOrchestrationAction(
      ["instance-dev-install"],
      onEvent,
      onOutput,
    );
    onStep?.(DEV_ENV_CONVERGE_STEP, "ok");
  } catch (error) {
    onStep?.(DEV_ENV_CONVERGE_STEP, "failed");
    throw error;
  }

  // Opt in only after converge succeeds so the post-converge daemon restart
  // picks up instance connectivity + docker integration.
  deps.writeDaemonInstanceEnv();

  // Converge / re-converge can run when bootstrap never finished the
  // turbopaneld unit install (e.g. prior apt failure). Install the unit first —
  // enable --now alone fails with "Unit turbopaneld.service does not exist".
  if (!deps.isDaemonSystemdInstalled()) {
    await deps.installDaemonSystemd(onOutput, onStep);
    // installDaemonSystemd → writeDaemonBaseEnv strips TURBOPANEL_DEV_INSTANCE;
    // restore instance opt-in + connectivity written above.
    deps.writeDaemonInstanceEnv();
  }

  if (deps.isDaemonServiceActive()) {
    await deps.requestDaemonRestart(onOutput);
  } else {
    await deps.enableAndStartDaemon(onOutput);
  }
}

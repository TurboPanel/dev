import { spawn } from "node:child_process";
import { bootstrapOrchestrationCommand, ensureBootstrapDeno } from "./daemon-exec.ts";
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
import {
  ensureDevPlatformAccess,
  ensureTurbopanelStateOwnership,
  resetTurbopanelUserCache,
  turbopanelUserExists,
} from "./turbopanel-permissions.ts";
import { agentDebugLog, probeCacheOwnership } from "./debug-agent-log.ts";
import { probeDaemonSystemd } from "../dev-services.ts";

const TURBOPANEL_USER = "turbopanel";
const DAEMON_DIR = DAEMON_REPO_DIR;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function bootstrapEnv(): string[] {
  return [
    `HOME=${TURBOPANEL_ROOT}`,
    `ANSIBLE_COLLECTIONS_PATH=${ANSIBLE_COLLECTIONS_PATH}`,
    `UV_PYTHON_INSTALL_DIR=${PYTHON_INSTALL_DIR}`,
    `UV_CACHE_DIR=${UV_CACHE_DIR}`,
    "UV_NO_MODIFY_PATH=1",
    "UV_PYTHON_DOWNLOADS=automatic",
    "UV_VENV_CLEAR=1",
  ];
}

function bootstrapSudoArgs(command: string): string[] {
  const envArgs = ["env", ...bootstrapEnv(), "bash", "-c", command];
  if (turbopanelUserExists()) {
    return ["-n", "-u", TURBOPANEL_USER, ...envArgs];
  }
  // Before Ansible creates turbopanel, bootstrap must install runtimes as root.
  return ["-n", ...envArgs];
}

async function prepareBootstrapEnvironment(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  await ensureDevPlatformAccess(onOutput);
  if (turbopanelUserExists()) {
    await ensureTurbopanelStateOwnership(onOutput, "prepareBootstrapEnvironment");
  }
}

export async function bootstrapOrchestration(
  onEvent: (event: unknown) => void,
  onOutput?: InstallOutputHandler,
): Promise<void> {
  await prepareBootstrapEnvironment(onOutput);

  await ensureBootstrapDeno(onOutput);

  if (turbopanelUserExists()) {
    await ensureTurbopanelStateOwnership(onOutput, "bootstrapOrchestration:pre-run");
  }

  const bootstrapInvocation = bootstrapOrchestrationCommand();
  const command =
    `cd ${shellQuote(DAEMON_DIR)} && exec ${bootstrapInvocation}`;
  const args = bootstrapSudoArgs(command);
  const bootstrapRanAsRoot = !turbopanelUserExists();

  // #region agent log
  agentDebugLog(
    "daemon-install.ts:bootstrapOrchestration:pre-run",
    "starting bootstrap orchestration",
    {
      bootstrapRanAsRoot,
      turbopanelExists: turbopanelUserExists(),
      cacheBefore: probeCacheOwnership(),
    },
    "H1",
  );
  // #endregion

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
        resetTurbopanelUserCache();
        const finalize = async () => {
          // #region agent log
          agentDebugLog(
            "daemon-install.ts:bootstrapOrchestration:finalize:enter",
            "bootstrap succeeded — running post ownership",
            {
              bootstrapRanAsRoot,
              turbopanelExists: turbopanelUserExists(),
              cacheBefore: probeCacheOwnership(),
            },
            "H3",
          );
          // #endregion
          await ensureDevPlatformAccess(onOutput);
          if (turbopanelUserExists() || bootstrapRanAsRoot) {
            await ensureTurbopanelStateOwnership(
              onOutput,
              "bootstrapOrchestration:finalize",
            );
          }
          // #region agent log
          agentDebugLog(
            "daemon-install.ts:bootstrapOrchestration:finalize:exit",
            "post-bootstrap ownership complete",
            {
              cacheAfter: probeCacheOwnership(),
            },
            "H3",
          );
          // #endregion
        };
        void finalize().then(resolve).catch(reject);
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

      const message = stderrTail || stdoutTail || "Bootstrap orchestration failed";
      reject(new Error(message));
    });
  });
}

export async function installDaemonSystemd(
  onOutput?: InstallOutputHandler,
  onStep?: InstallStepHandler,
): Promise<void> {
  onStep?.("Install turbopanel-daemon systemd unit", "running");
  onStep?.("Enable and start turbopanel-daemon", "running");

  resetTurbopanelUserCache();
  await ensureDevPlatformAccess(onOutput);
  await ensureTurbopanelStateOwnership(onOutput, "installDaemonSystemd:pre-start");

  // #region agent log
  agentDebugLog(
    "daemon-install.ts:installDaemonSystemd:pre-start",
    "ownership applied before systemd install",
    { cacheAfter: probeCacheOwnership() },
    "H2",
  );
  // #endregion

  const command =
    `cd ${shellQuote(DAEMON_DIR)} && exec bash ${shellQuote("scripts/install-daemon-systemd.sh")}`;

  const code = await runCaptured(["sudo", "bash", "-c", command], onOutput);

  if (code !== 0) {
    onStep?.("Install turbopanel-daemon systemd unit", "failed");
    onStep?.("Enable and start turbopanel-daemon", "failed");
    throw new Error("Install daemon systemd failed");
  }

  onStep?.("Install turbopanel-daemon systemd unit", "ok");
  await ensureTurbopanelStateOwnership(onOutput, "installDaemonSystemd:post-start");

  await runCaptured(
    ["sudo", "-n", "systemctl", "restart", "turbopanel-daemon"],
    onOutput,
  );

  // #region agent log
  agentDebugLog(
    "daemon-install.ts:installDaemonSystemd:post-start",
    "systemd install finished",
    {
      cacheAfter: probeCacheOwnership(),
      systemd: probeDaemonSystemd(),
    },
    "H3",
    "post-fix",
  );
  // #endregion

  onStep?.("Enable and start turbopanel-daemon", "ok");
}

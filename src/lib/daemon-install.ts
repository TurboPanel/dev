import { spawn, spawnSync } from "node:child_process";
import {
  ANSIBLE_COLLECTIONS_PATH,
  DAEMON_DENO_CONFIG,
  DAEMON_REPO_DIR,
  DENO_BIN,
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

const TURBOPANEL_USER = "turbopanel";
const TURBOPANEL_GROUP = "turbopanel";
const DAEMON_DIR = DAEMON_REPO_DIR;

let turbopanelUserExistsCache: boolean | null = null;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

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

async function ensureTurbopanelOwnership(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  if (!turbopanelUserExists()) {
    return;
  }

  const ownedPaths = [
    RUNTIMES_DIR,
    `${TURBOPANEL_ROOT}/.cache`,
    `${TURBOPANEL_ROOT}/.ansible`,
    `${TURBOPANEL_ROOT}/.local`,
  ];

  for (const path of ownedPaths) {
    const code = await runCaptured([
      "sudo",
      "chown",
      "-R",
      `${TURBOPANEL_USER}:${TURBOPANEL_GROUP}`,
      path,
    ], onOutput);

    if (code !== 0) {
      throw new Error(`Failed to set ownership on ${path}`);
    }
  }
}

export async function bootstrapOrchestration(
  onEvent: (event: unknown) => void,
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const denoInvocation = [
    DENO_BIN,
    "run",
    "--config",
    DAEMON_DENO_CONFIG,
    "--allow-net",
    "--allow-read",
    "--allow-write",
    "--allow-run",
    "--allow-env",
    `${DAEMON_DIR}/scripts/bootstrap-orchestration.ts`,
  ].map(shellQuote).join(" ");

  const command = `cd ${shellQuote(DAEMON_DIR)} && exec ${denoInvocation}`;
  // Bootstrap installs shared runtimes as root; hand ownership to turbopanel after.
  const args = ["-n", "env", ...bootstrapEnv(), "bash", "-c", command];

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
        void ensureTurbopanelOwnership(onOutput).then(resolve).catch(reject);
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

  const command =
    `cd ${shellQuote(DAEMON_DIR)} && exec bash ${shellQuote("scripts/install-daemon-systemd.sh")}`;

  const code = await runCaptured(["sudo", "bash", "-c", command], onOutput);

  if (code !== 0) {
    onStep?.("Install turbopanel-daemon systemd unit", "failed");
    onStep?.("Enable and start turbopanel-daemon", "failed");
    throw new Error("Install daemon systemd failed");
  }

  onStep?.("Install turbopanel-daemon systemd unit", "ok");
  onStep?.("Enable and start turbopanel-daemon", "ok");
  await ensureTurbopanelOwnership(onOutput);
}

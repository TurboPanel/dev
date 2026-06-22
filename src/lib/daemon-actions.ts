import { spawnSync } from "node:child_process";
import type { DevServiceStatus } from "../dev-services.ts";
import { isDaemonSystemdInstalled } from "../dev-services.ts";
import {
  DAEMON_REPO_DIR,
  RUNTIMES_DIR,
  TURBOPANEL_ROOT,
} from "./paths.ts";
import {
  ensureBootstrapDeno,
  resolveBootstrapDenoBin,
  systemDenoInstalled,
} from "./daemon-exec.ts";
import { SYSTEM_DENO_BIN } from "./paths.ts";
import { type InstallOutputHandler, runCaptured } from "./install-output.ts";

export type DaemonActionId =
  | "install"
  | "repair"
  | "restart"
  | "purge"
  | "start-dev-env"
  | "build-daemon-binaries";

const DAEMON_UNIT = "turbopanel-daemon";
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_WAIT_POLL_MS = 500;

export const DAEMON_ACTION_LABELS: Record<DaemonActionId, string> = {
  install: "Install",
  repair: "Repair install",
  restart: "Restart",
  purge: "Purge completely",
  "start-dev-env": "Start development environment",
  "build-daemon-binaries": "Build daemon binaries (amd64 + arm64)",
};

export function daemonMenuActions(_status: DevServiceStatus): DaemonActionId[] {
  return [];
}

export function developerMenuActions(status: DevServiceStatus | undefined): DaemonActionId[] {
  if (!status || status === "uninstalled") {
    return [];
  }

  return ["repair", "start-dev-env", "build-daemon-binaries", "purge"];
}

export function canRestartDaemon(): boolean {
  return isDaemonSystemdInstalled();
}

export function isDaemonServiceActive(): boolean {
  const result = spawnSync("systemctl", ["is-active", DAEMON_UNIT], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return (result.stdout ?? "").trim() === "active";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForDaemonRunning(
  options: {
    timeoutMs?: number;
    pollMs?: number;
    onPoll?: (elapsedMs: number) => void;
  } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_WAIT_POLL_MS;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (isDaemonServiceActive()) {
      return true;
    }
    options.onPoll?.(Date.now() - started);
    await sleep(pollMs);
  }

  return isDaemonServiceActive();
}

/** First activation after opt-in — enable the unit and start it (not a restart). */
export async function enableAndStartDaemon(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const lines: string[] = [];
  const append = (line: string) => {
    lines.push(line);
    onOutput?.(line);
  };

  const code = await runCaptured(
    ["sudo", "-n", "systemctl", "enable", "--now", DAEMON_UNIT],
    append,
  );
  if (code !== 0) {
    throw new Error(lines.at(-1) ?? "Failed to enable and start turbopanel-daemon");
  }
}

/** Queue a daemon restart without blocking until the service is active again. */
export async function requestDaemonRestart(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const lines: string[] = [];
  const append = (line: string) => {
    lines.push(line);
    onOutput?.(line);
  };

  const code = await runCaptured(
    ["sudo", "systemctl", "restart", "--no-block", DAEMON_UNIT],
    append,
  );
  if (code !== 0) {
    throw new Error(lines.at(-1) ?? "Failed to restart daemon");
  }
}

/** @deprecated Use {@link requestDaemonRestart} — blocks until systemd reports active. */
export async function restartDaemon(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  await requestDaemonRestart(onOutput);
  const running = await waitForDaemonRunning();
  if (!running) {
    throw new Error("Daemon did not become active after restart");
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export async function purgeDaemon(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const pathsToRemove = [
    DAEMON_REPO_DIR,
    RUNTIMES_DIR,
    `${TURBOPANEL_ROOT}/.cache`,
    `${TURBOPANEL_ROOT}/.ansible`,
    `${TURBOPANEL_ROOT}/.local`,
  ].map(shellQuote);

  const command = [
    "systemctl stop turbopanel-daemon 2>/dev/null || true",
    "systemctl disable turbopanel-daemon 2>/dev/null || true",
    "rm -f /etc/systemd/system/turbopanel-daemon.service",
    "systemctl daemon-reload",
    ...pathsToRemove.map((path) => `rm -rf ${path}`),
  ].join(" && ");

  const code = await runCaptured(["sudo", "bash", "-c", command], onOutput);
  if (code !== 0) {
    throw new Error("Failed to purge daemon");
  }
}

export async function buildDaemonBinaries(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  // Host PATH may point at a dev-home Deno the turbopanel user cannot execute.
  resolveBootstrapDenoBin();
  if (!systemDenoInstalled()) {
    await ensureBootstrapDeno(onOutput);
  }
  const command =
    `cd ${shellQuote(DAEMON_REPO_DIR)} && ${shellQuote(SYSTEM_DENO_BIN)} task compile:all`;

  const lines: string[] = [];
  const append = (line: string) => {
    lines.push(line);
    onOutput?.(line);
  };

  const code = await runCaptured(
    [
      "sudo",
      "-n",
      "-u",
      "turbopanel",
      "env",
      "HOME=/opt/turbopanel",
      "bash",
      "-c",
      command,
    ],
    append,
  );
  if (code !== 0) {
    throw new Error(lines.at(-1) ?? "Failed to build daemon binaries");
  }
}

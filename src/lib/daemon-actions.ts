import { spawnSync } from "node:child_process";
import type { DevServiceStatus } from "../dev-services.ts";
import { isDaemonSystemdInstalled } from "../dev-services.ts";
import {
  DAEMON_REPO_DIR,
  RUNTIMES_DIR,
  TURBOPANEL_ROOT,
} from "./paths.ts";
import { type InstallOutputHandler, runCaptured } from "./install-output.ts";
import { syncDevToAllDaemons } from "./developer-client.ts";

export type DaemonActionId =
  | "install"
  | "repair"
  | "restart"
  | "purge"
  | "start-dev-env"
  | "reset-dev-env"
  | "reset-dev-db"
  | "sync-dev-build";

const DAEMON_UNIT = "turbopanel-daemon";
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_WAIT_POLL_MS = 500;

export const DAEMON_ACTION_LABELS: Record<DaemonActionId, string> = {
  install: "Install",
  repair: "Repair install",
  restart: "Restart",
  purge: "Purge completely",
  "start-dev-env": "Start development environment",
  "reset-dev-env": "Reset development environment",
  "reset-dev-db": "Reset dev database",
  "sync-dev-build": "Sync dev build to attached daemons",
};

export function daemonMenuActions(_status: DevServiceStatus): DaemonActionId[] {
  return [];
}

export function developerMenuActions(status: DevServiceStatus | undefined): DaemonActionId[] {
  if (!status || status === "uninstalled") {
    return [];
  }

  return [
    "repair",
    "start-dev-env",
    "reset-dev-env",
    "reset-dev-db",
    "sync-dev-build",
    "purge",
  ];
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

/**
 * Push the local daemon source build to every attached daemon via the live
 * instance developer API (`/api/developer/v1/daemon/sync-dev`). This replaces
 * the old local `release:package` binary build — the daemon runs from source and
 * dev pushes are streamed/unpacked by each daemon.
 */
export async function syncDevBuildToDaemons(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const append = (line: string) => onOutput?.(line);

  append("Packaging local daemon source and syncing to attached daemons…");

  let response;
  try {
    response = await syncDevToAllDaemons();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not reach the instance developer API: ${message}`);
  }

  const results = response.results ?? [];
  if (results.length === 0) {
    append("No attached daemons are currently connected.");
    return;
  }

  for (const result of results) {
    if (result.skipped) {
      append(`– ${result.daemonId}: skipped (${result.error ?? "co-located dev daemon"})`);
    } else if (result.ok) {
      append(`✓ ${result.daemonId}: synced`);
    } else {
      append(`✗ ${result.daemonId}: ${result.error ?? "sync failed"}`);
    }
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    throw new Error(
      `${failed.length} of ${results.length} daemon(s) failed to sync`,
    );
  }

  const synced = results.filter((result) => result.ok && !result.skipped);
  if (synced.length > 0) {
    append(`Synced ${synced.length} daemon(s) successfully.`);
  }
}

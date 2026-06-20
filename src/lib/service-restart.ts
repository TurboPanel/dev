import { spawnSync } from "node:child_process";
import { spawnDocker } from "./docker-access.ts";
import { runCaptured } from "./install-output.ts";

const SYSTEMD_UNITS: Record<string, string> = {
  daemon: "turbopanel-daemon",
  instance: "turbopanel-instance",
  ui: "turbopanel-ui",
  website: "turbopanel-website",
  cache: "turbopanel-redis",
  queue: "turbopanel-rabbitmq",
};

const DOCKER_CONTAINERS: Record<string, string> = {
  db: "turbopaneldb",
};

export type ServiceActiveState =
  | "active"
  | "inactive"
  | "activating"
  | "deactivating"
  | "failed"
  | "unknown";

export type ConsoleLogLine = {
  text: string;
  time: string;
};

const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_WAIT_POLL_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function systemctlProperty(unit: string, property: string): string | null {
  const result = spawnSync(
    "systemctl",
    ["show", unit, `--property=${property}`, "--value"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  if (result.status !== 0) {
    return null;
  }
  const value = (result.stdout ?? "").trim();
  return value.length > 0 ? value : null;
}

function isSystemdUnitInstalled(unit: string): boolean {
  const loadState = systemctlProperty(unit, "LoadState");
  return loadState === "loaded" || loadState === "masked";
}

function resolveSystemdUnit(serviceId: string): string | null {
  const unit = SYSTEMD_UNITS[serviceId];
  if (!unit || !isSystemdUnitInstalled(unit)) {
    return null;
  }
  return unit;
}

function resolveDockerContainer(serviceId: string): string | null {
  const container = DOCKER_CONTAINERS[serviceId];
  if (!container) {
    return null;
  }
  const result = spawnDocker(["inspect", container]);
  return result?.status === 0 ? container : null;
}

function mapSystemdState(value: string | null): ServiceActiveState {
  switch (value) {
    case "active":
      return "active";
    case "inactive":
    case "dead":
      return "inactive";
    case "activating":
      return "activating";
    case "deactivating":
      return "deactivating";
    case "failed":
      return "failed";
    default:
      return "unknown";
  }
}

export function serviceRestartTarget(
  serviceId: string,
): { kind: "systemd"; unit: string } | { kind: "docker"; container: string } | null {
  const unit = resolveSystemdUnit(serviceId);
  if (unit) {
    return { kind: "systemd", unit };
  }
  const container = resolveDockerContainer(serviceId);
  if (container) {
    return { kind: "docker", container };
  }
  return null;
}

export function queryServiceActiveState(serviceId: string): ServiceActiveState {
  const target = serviceRestartTarget(serviceId);
  if (!target) {
    return "unknown";
  }

  if (target.kind === "systemd") {
    return mapSystemdState(systemctlProperty(target.unit, "ActiveState"));
  }

  const result = spawnDocker(["inspect", "-f", "{{.State.Running}}", target.container]);
  const value = (result?.stdout ?? "").trim();
  if (value === "true") {
    return "active";
  }
  if (value === "false") {
    return "inactive";
  }
  return "unknown";
}

export function consoleLogLine(text: string): ConsoleLogLine {
  return { text, time: new Date().toISOString() };
}

function restartDisplayName(serviceId: string, label: string): string {
  const target = serviceRestartTarget(serviceId);
  if (target?.kind === "systemd") {
    return target.unit;
  }
  if (target?.kind === "docker") {
    return target.container;
  }
  return label;
}

async function runSystemctl(args: string[]): Promise<void> {
  const code = await runCaptured(["sudo", "-n", "systemctl", ...args]);
  if (code !== 0) {
    throw new Error(`systemctl ${args.join(" ")} failed`);
  }
}

async function runDocker(args: string[]): Promise<void> {
  const attempts: string[][] = [
    ["sudo", "-n", "-u", "turbopanel", "docker", ...args],
    ["sudo", "-n", "docker", ...args],
  ];

  for (const cmd of attempts) {
    const code = await runCaptured(cmd);
    if (code === 0) {
      return;
    }
  }

  throw new Error(`docker ${args.join(" ")} failed`);
}

async function requestServiceRestart(
  serviceId: string,
  onLog: (line: ConsoleLogLine) => void,
): Promise<void> {
  const target = serviceRestartTarget(serviceId);
  if (!target) {
    throw new Error(`No systemd unit or Docker container found for ${serviceId}`);
  }

  const name = restartDisplayName(serviceId, serviceId);
  if (target.kind === "systemd") {
    onLog(consoleLogLine(`[console] requesting restart of ${name}…`));
    await runSystemctl(["restart", "--no-block", target.unit]);
    return;
  }

  onLog(consoleLogLine(`[console] requesting restart of container ${name}…`));
  onLog(consoleLogLine(`[console] ${name} shutting down…`));
  await runDocker(["restart", target.container]);
}

export async function watchServiceRestart(
  serviceId: string,
  label: string,
  onLog: (line: ConsoleLogLine) => void,
  options: {
    timeoutMs?: number;
    pollMs?: number;
  } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_WAIT_POLL_MS;
  const name = restartDisplayName(serviceId, label);
  const target = serviceRestartTarget(serviceId);
  const wasActive = queryServiceActiveState(serviceId) === "active";

  await requestServiceRestart(serviceId, onLog);

  if (target?.kind === "docker") {
    const active = queryServiceActiveState(serviceId) === "active";
    if (active) {
      onLog(consoleLogLine(`[console] ${name} is active`));
    } else {
      onLog(consoleLogLine(`[console] ${name} did not become active`));
    }
    return active;
  }

  const started = Date.now();
  let loggedStopping = false;
  let loggedStopped = false;
  let loggedStarting = false;

  while (Date.now() - started < timeoutMs) {
    const state = queryServiceActiveState(serviceId);

    if (
      target?.kind === "systemd" &&
      wasActive &&
      (state === "deactivating" || state === "inactive") &&
      !loggedStopping
    ) {
      loggedStopping = true;
      onLog(consoleLogLine(`[console] ${name} shutting down (systemd: ${state})`));
    }

    if (wasActive && state === "inactive" && !loggedStopped) {
      loggedStopped = true;
      onLog(consoleLogLine(`[console] ${name} stopped`));
    }

    if (loggedStopped && state === "activating" && !loggedStarting) {
      loggedStarting = true;
      onLog(consoleLogLine(`[console] ${name} starting up (systemd: activating)`));
    }

    if (state === "active") {
      onLog(consoleLogLine(`[console] ${name} is active`));
      return true;
    }

    await sleep(pollMs);
  }

  const finalState = queryServiceActiveState(serviceId);
  if (finalState === "active") {
    onLog(consoleLogLine(`[console] ${name} is active`));
    return true;
  }

  onLog(consoleLogLine(`[console] ${name} did not become active (last state: ${finalState})`));
  return false;
}

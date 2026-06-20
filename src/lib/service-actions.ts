import { spawnSync } from "node:child_process";
import type { DevServiceStatus } from "../dev-services.ts";
import { spawnDocker } from "./docker-access.ts";
import { type InstallOutputHandler, runCaptured } from "./install-output.ts";
import { openServiceInBrowser } from "./service-open.ts";
import { serviceSupportsOpen } from "./service-urls.ts";

export type ServiceActionId =
  | "restart"
  | "disable"
  | "enable"
  | "open"
  | "switch-workers"
  | "switch-deno";

const SYSTEMD_UNITS: Record<string, string> = {
  daemon: "turbopanel-daemon",
  instance: "turbopanel-instance",
  web: "turbopanel-caddy",
  dbstudio: "turbopanel-dbstudio",
  ui: "turbopanel-ui",
  website: "turbopanel-website",
  cache: "turbopanel-redis",
  queue: "turbopanel-rabbitmq",
  smtp: "turbopanel-mailpit",
};

const DOCKER_CONTAINERS: Record<string, string> = {
  db: "turbopaneldb",
  smtp: "turbopanelmailpit",
};

const OPEN_START_UNITS: Record<string, string> = {
  instance: "turbopanel-caddy",
  web: "turbopanel-caddy",
  ui: "turbopanel-caddy",
  website: "turbopanel-website",
  dbstudio: "turbopanel-dbstudio",
  queue: "turbopanel-rabbitmq",
  smtp: "turbopanel-mailpit",
};

const MANAGED_SERVICE_IDS = new Set([
  "daemon",
  "instance",
  "web",
  "dbstudio",
  "ui",
  "website",
  "db",
  "cache",
  "queue",
  "smtp",
]);

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

async function runSystemctl(
  args: string[],
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const code = await runCaptured(["sudo", "-n", "systemctl", ...args], onOutput);
  if (code !== 0) {
    throw new Error(`systemctl ${args.join(" ")} failed`);
  }
}

async function runDocker(
  args: string[],
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const attempts: string[][] = [
    ["sudo", "-n", "-u", "turbopanel", "docker", ...args],
    ["sudo", "-n", "docker", ...args],
  ];

  for (const cmd of attempts) {
    const code = await runCaptured(cmd, onOutput);
    if (code === 0) {
      return;
    }
  }

  throw new Error(`docker ${args.join(" ")} failed`);
}

export function isManagedService(serviceId: string): boolean {
  return MANAGED_SERVICE_IDS.has(serviceId);
}

export function serviceActionForKey(
  serviceId: string,
  key: string,
  instanceRuntime: "deno" | "workers",
): ServiceActionId | null {
  if (!isManagedService(serviceId)) {
    return null;
  }

  const normalized = key.toLowerCase();
  if (normalized === "r") {
    return "restart";
  }
  if (normalized === "x") {
    return "disable";
  }
  if (normalized === "e") {
    return "enable";
  }
  if (normalized === "o" && serviceSupportsOpen(serviceId)) {
    return "open";
  }
  if (serviceId === "instance" && instanceRuntime === "deno" && normalized === "w") {
    return "switch-workers";
  }
  if (serviceId === "instance" && instanceRuntime === "workers" && normalized === "d") {
    return "switch-deno";
  }
  return null;
}

export function canRunServiceAction(
  serviceId: string,
  action: ServiceActionId,
  status: DevServiceStatus,
  instanceRuntime: "deno" | "workers",
): boolean {
  if (status === "uninstalled") {
    return false;
  }
  if (action === "switch-workers") {
    return serviceId === "instance" && instanceRuntime === "deno";
  }
  if (action === "switch-deno") {
    return serviceId === "instance" && instanceRuntime === "workers";
  }
  if (action === "open") {
    if (!serviceSupportsOpen(serviceId)) {
      return false;
    }
    const startUnit = OPEN_START_UNITS[serviceId];
    if (startUnit && isSystemdUnitInstalled(startUnit)) {
      return true;
    }
    return resolveDockerContainer(serviceId) !== null;
  }
  if (!isManagedService(serviceId)) {
    return false;
  }
  if (action === "enable" && status === "running") {
    return false;
  }
  if (action === "disable" && status === "stopped") {
    return false;
  }
  return resolveSystemdUnit(serviceId) !== null || resolveDockerContainer(serviceId) !== null;
}

export async function runServiceAction(
  serviceId: string,
  action: ServiceActionId,
  onOutput?: InstallOutputHandler,
): Promise<void> {
  if (action === "open") {
    await openServiceInBrowser(
      serviceId,
      async () => {
        const unit = OPEN_START_UNITS[serviceId];
        if (!unit) {
          throw new Error(`No start unit configured for ${serviceId}`);
        }
        if (!isSystemdUnitInstalled(unit)) {
          throw new Error(`${unit} is not installed`);
        }
        await runSystemctl(["start", unit], onOutput);
      },
      onOutput,
    );
    return;
  }

  if (action === "switch-workers" || action === "switch-deno") {
    const { switchInstanceRuntime } = await import("./instance-runtime.ts");
    await switchInstanceRuntime(
      action === "switch-workers" ? "workers" : "deno",
      onOutput,
    );
    return;
  }

  const unit = resolveSystemdUnit(serviceId);
  if (unit) {
    switch (action) {
      case "restart":
        await runSystemctl(["restart", "--no-block", unit], onOutput);
        return;
      case "disable":
        await runSystemctl(["disable", "--now", unit], onOutput);
        return;
      case "enable":
        await runSystemctl(["enable", "--now", unit], onOutput);
        return;
    }
  }

  const container = resolveDockerContainer(serviceId);
  if (!container) {
    throw new Error(`No systemd unit or Docker container found for ${serviceId}`);
  }

  switch (action) {
    case "restart":
      await runDocker(["restart", container], onOutput);
      return;
    case "disable":
      await runDocker(["update", "--restart=no", container], onOutput);
      await runDocker(["stop", container], onOutput);
      return;
    case "enable":
      await runDocker(["update", "--restart=unless-stopped", container], onOutput);
      await runDocker(["start", container], onOutput);
      return;
  }
}

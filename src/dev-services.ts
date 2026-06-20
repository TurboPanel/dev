import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { DAEMON_REPO_DIR, platformRepoPath } from "./lib/paths.ts";

export type DevServiceStatus =
  | "running"
  | "starting"
  | "stopped"
  | "pending"
  | "uninstalled";

export type DevService = {
  id: string;
  label: string;
  status: DevServiceStatus;
};

const DAEMON_UNIT = "turbopanel-daemon";

const DOWNSTREAM_SERVICE_DEFS = [
  {
    id: "instance",
    label: "instance",
    unit: "turbopanel-instance",
    repoDir: platformRepoPath("instance"),
  },
  {
    id: "ui",
    label: "ui",
    unit: "turbopanel-ui",
    repoDir: platformRepoPath("ui"),
  },
  {
    id: "website",
    label: "website",
    unit: "turbopanel-website",
    repoDir: platformRepoPath("website"),
  },
] as const;

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

export function isDaemonRepoInstalled(): boolean {
  try {
    if (existsSync(DAEMON_REPO_DIR)) {
      return true;
    }
  } catch {
    // Platform checkout may be turbopanel-owned and not visible to the dev user.
  }

  return isDaemonSystemdInstalled();
}

function isSystemdUnitInstalled(unit: string): boolean {
  const loadState = systemctlProperty(unit, "LoadState");
  return loadState === "loaded" || loadState === "masked";
}

export function isDaemonSystemdInstalled(): boolean {
  return isSystemdUnitInstalled(DAEMON_UNIT);
}

function isRepoInstalled(repoDir: string): boolean {
  try {
    return existsSync(repoDir);
  } catch {
    // Platform checkout may be turbopanel-owned and not visible to the dev user.
    return false;
  }
}

function systemdServiceStatus(unit: string): DevServiceStatus | null {
  if (!isSystemdUnitInstalled(unit)) {
    return null;
  }

  const activeState = systemctlProperty(unit, "ActiveState");
  const subState = systemctlProperty(unit, "SubState");

  if (activeState === "active") {
    return "running";
  }

  if (
    activeState === "failed" ||
    (activeState === "activating" && subState === "auto-restart")
  ) {
    return "pending";
  }

  if (activeState === "activating" || activeState === "reloading") {
    return "starting";
  }

  return "stopped";
}

function serviceStatus(unit: string, repoDir?: string): DevServiceStatus {
  const fromSystemd = systemdServiceStatus(unit);
  if (fromSystemd !== null) {
    return fromSystemd;
  }

  if (repoDir && isRepoInstalled(repoDir)) {
    return "pending";
  }

  return "uninstalled";
}

function daemonStatus(): DevServiceStatus {
  const fromSystemd = systemdServiceStatus(DAEMON_UNIT);
  if (fromSystemd !== null) {
    return fromSystemd;
  }

  if (isDaemonRepoInstalled()) {
    return "pending";
  }

  return "uninstalled";
}

function downstreamServices(): DevService[] {
  return DOWNSTREAM_SERVICE_DEFS
    .filter(({ unit, repoDir }) => isSystemdUnitInstalled(unit) || isRepoInstalled(repoDir))
    .map(({ id, label, unit, repoDir }) => ({
      id,
      label,
      status: serviceStatus(unit, repoDir),
    }));
}

export function isDaemonInstallable(status: DevServiceStatus): boolean {
  return status !== "running";
}

export function getVisibleServices(): DevService[] {
  const daemon: DevService = {
    id: "daemon",
    label: "daemon",
    status: daemonStatus(),
  };

  return [daemon, ...downstreamServices()];
}

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { DAEMON_REPO_DIR } from "./lib/paths.ts";

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

const DOWNSTREAM_SERVICES: DevService[] = [
  { id: "instance", label: "instance", status: "uninstalled" },
  { id: "ui", label: "ui", status: "uninstalled" },
  { id: "website", label: "website", status: "uninstalled" },
];

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

export function isDaemonSystemdInstalled(): boolean {
  const loadState = systemctlProperty(DAEMON_UNIT, "LoadState");
  return loadState === "loaded" || loadState === "masked";
}

function daemonStatus(): DevServiceStatus {
  if (isDaemonSystemdInstalled()) {
    const activeState = systemctlProperty(DAEMON_UNIT, "ActiveState");
    const subState = systemctlProperty(DAEMON_UNIT, "SubState");

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

  if (isDaemonRepoInstalled()) {
    return "pending";
  }

  return "uninstalled";
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

  if (daemon.status !== "running") {
    return [daemon];
  }

  return [daemon, ...DOWNSTREAM_SERVICES];
}

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isDevInstanceEnabled, readInstanceRuntime } from "./lib/daemon-env.ts";
import { DAEMON_REPO_DIR, platformRepoPath } from "./lib/paths.ts";
import { spawnAsTurbopanel, spawnDocker } from "./lib/docker-access.ts";

export type DevServiceStatus =
  | "running"
  | "starting"
  | "failed"
  | "stopped"
  | "pending"
  | "uninstalled";

export type DevService = {
  id: string;
  label: string;
  status: DevServiceStatus;
};

const DAEMON_UNIT = "turbopanel-daemon";
const POSTGRES_CONTAINER = "turbopaneldb";
const POSTGRES_SOCKET = "/var/run/turbopanel/postgres/.s.PGSQL.5432";

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

const ANCILLARY_DENO_DEFS = [
  { id: "db", label: "db", kind: "postgres" as const },
  { id: "cache", label: "cache", unit: "turbopanel-redis" },
  { id: "queue", label: "queue", unit: "turbopanel-rabbitmq" },
] as const;

const ANCILLARY_WORKERS_DEFS = [
  { id: "db", label: "db", kind: "postgres" as const },
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

function parseDockerRunningOutput(stdout: string | undefined): boolean | null {
  const value = (stdout ?? "").trim();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}

function dockerContainerRunning(name: string): boolean | null {
  const result = spawnDocker([
    "inspect",
    "-f",
    "{{.State.Running}}",
    name,
  ]);
  if (!result) {
    return null;
  }
  return parseDockerRunningOutput(result.stdout);
}

function dockerContainerExists(name: string): boolean {
  return dockerContainerRunning(name) !== null;
}

function postgresSocketReady(): boolean {
  try {
    if (existsSync(POSTGRES_SOCKET)) {
      return true;
    }
  } catch {
    // The postgres socket dir is not traversable by the dev user.
  }

  const sudoResult = spawnAsTurbopanel(["test", "-S", POSTGRES_SOCKET]);
  return sudoResult?.status === 0;
}

function postgresStatus(): DevServiceStatus {
  if (postgresSocketReady()) {
    return "running";
  }

  const running = dockerContainerRunning(POSTGRES_CONTAINER);
  if (running === true) {
    return "running";
  }
  if (running === false) {
    return "stopped";
  }
  if (dockerContainerExists(POSTGRES_CONTAINER)) {
    return "stopped";
  }

  return "uninstalled";
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

  if (activeState === "failed") {
    return "failed";
  }

  if (activeState === "activating" && subState === "auto-restart") {
    return "starting";
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

function shouldShowAncillaryServices(): boolean {
  if (isDevInstanceEnabled()) {
    return true;
  }
  if (dockerContainerExists(POSTGRES_CONTAINER)) {
    return true;
  }
  if (isSystemdUnitInstalled("turbopanel-redis")) {
    return true;
  }
  if (isSystemdUnitInstalled("turbopanel-rabbitmq")) {
    return true;
  }
  return downstreamServices().length > 0;
}

function ancillaryServices(): DevService[] {
  if (!shouldShowAncillaryServices()) {
    return [];
  }

  const defs = readInstanceRuntime() === "workers"
    ? ANCILLARY_WORKERS_DEFS
    : ANCILLARY_DENO_DEFS;

  return defs.map((def) => {
    if ("kind" in def) {
      return {
        id: def.id,
        label: def.label,
        status: postgresStatus(),
      };
    }

    const status = systemdServiceStatus(def.unit);
    return {
      id: def.id,
      label: def.label,
      status: status ?? "uninstalled",
    };
  });
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

  return [daemon, ...downstreamServices(), ...ancillaryServices()];
}

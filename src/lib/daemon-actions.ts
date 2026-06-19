import type { DevServiceStatus } from "../dev-services.ts";
import { isDaemonSystemdInstalled } from "../dev-services.ts";
import { DAEMON_REPO_DIR } from "./paths.ts";
import { type InstallOutputHandler, runCaptured } from "./install-output.ts";

export type DaemonActionId = "install" | "repair" | "restart" | "purge";

export const DAEMON_ACTION_LABELS: Record<DaemonActionId, string> = {
  install: "Install",
  repair: "Repair install",
  restart: "Restart",
  purge: "Purge completely",
};

export function daemonMenuActions(status: DevServiceStatus): DaemonActionId[] {
  if (status === "uninstalled") {
    return [];
  }

  const actions: DaemonActionId[] = [];
  if (status === "pending" || status === "stopped" || status === "starting") {
    actions.push("repair");
  }
  if (isDaemonSystemdInstalled()) {
    actions.push("restart");
  }
  actions.push("purge");
  return actions;
}

export async function restartDaemon(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const lines: string[] = [];
  const append = (line: string) => {
    lines.push(line);
    onOutput?.(line);
  };

  const code = await runCaptured(
    ["sudo", "systemctl", "restart", "turbopanel-daemon"],
    append,
  );
  if (code !== 0) {
    throw new Error(lines.at(-1) ?? "Failed to restart daemon");
  }
}

export async function purgeDaemon(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const command = [
    "systemctl stop turbopanel-daemon 2>/dev/null || true",
    "systemctl disable turbopanel-daemon 2>/dev/null || true",
    "rm -f /etc/systemd/system/turbopanel-daemon.service",
    "systemctl daemon-reload",
    `rm -rf '${DAEMON_REPO_DIR.replace(/'/g, "'\\''")}'`,
  ].join(" && ");

  const code = await runCaptured(["sudo", "bash", "-c", command], onOutput);
  if (code !== 0) {
    throw new Error("Failed to purge daemon");
  }
}

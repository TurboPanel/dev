import {
  fetchStackStatus,
  instanceSocketPresent,
  type StackUnitStatus,
} from "@turbopanel/stack-status";
import { fetchHealth } from "@turbopanel/instance-client";

export type InstanceRecoverySnapshot = {
  active: true;
  reason: string;
  message: string;
  instanceDetail: string;
  socketReady: boolean;
  apiHealthy: boolean;
  stack: StackUnitStatus[];
};

const RECOVERY_POLL_MS = 1_500;
const RECOVERY_TIMEOUT_MS = 120_000;

function instanceUnitDetail(stack: StackUnitStatus[]): string {
  const unit = stack.find((entry) => entry.unit === "turbopanel-instance");
  return unit?.detail ?? "unknown";
}

function recoveryMessage(
  instanceDetail: string,
  socketReady: boolean,
  apiHealthy: boolean,
): string {
  if (!socketReady) {
    if (instanceDetail === "activating") {
      return "Instance is restarting — please stand by…";
    }
    if (instanceDetail === "inactive" || instanceDetail === "failed") {
      return "Instance stopped — waiting for systemd to bring it back…";
    }
    return "Waiting for instance Unix socket…";
  }
  if (!apiHealthy) {
    return "Socket is up — waiting for API health…";
  }
  return "Instance is back online";
}

export function isInstanceUnavailableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const text = err.message.toLowerCase();
  return text.includes("502") ||
    text.includes("503") ||
    text.includes("connection refused") ||
    text.includes("connection reset") ||
    text.includes("broken pipe") ||
    text.includes("not connected") ||
    text.includes("instance socket") ||
    text.includes("unreachable");
}

export async function waitForInstanceRecovery(
  reason: string,
  onUpdate: (snapshot: InstanceRecoverySnapshot) => void,
): Promise<boolean> {
  const deadline = Date.now() + RECOVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const stack = fetchStackStatus();
    const instanceDetail = instanceUnitDetail(stack);
    const socketReady = instanceSocketPresent();
    let apiHealthy = false;
    if (socketReady) {
      try {
        const health = await fetchHealth();
        apiHealthy = health.ok;
      } catch {
        apiHealthy = false;
      }
    }

    const message = recoveryMessage(instanceDetail, socketReady, apiHealthy);

    onUpdate({
      active: true,
      reason,
      message,
      instanceDetail,
      socketReady,
      apiHealthy,
      stack,
    });

    if (socketReady && apiHealthy) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, RECOVERY_POLL_MS));
  }

  return false;
}

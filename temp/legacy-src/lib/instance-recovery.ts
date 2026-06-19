import { fetchHealth } from "@turbopanel/lib/instance-client.ts";
import { readInstanceRuntime } from "@turbopanel/lib/instance-runtime.ts";
import {
  checkInstanceApiHealth,
  fetchStackStatus,
  instanceSocketPresent,
  type StackUnitStatus,
} from "@turbopanel/lib/stack-status.ts";

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
  runtime: "deno" | "workers",
  instanceDetail: string,
  socketReady: boolean,
  apiHealthy: boolean,
): string {
  if (runtime === "workers") {
    if (!apiHealthy) {
      if (instanceDetail === "activating") {
        return "Wrangler dev is restarting — please stand by…";
      }
      if (instanceDetail === "inactive" || instanceDetail === "failed") {
        return "Instance unit stopped — waiting for wrangler dev…";
      }
      return "Waiting for Workers instance API health…";
    }
    return "Workers instance is back online";
  }

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
    const runtime = readInstanceRuntime();
    const stack = fetchStackStatus();
    const instanceDetail = instanceUnitDetail(stack);
    const socketReady = instanceSocketPresent();
    let apiHealthy = false;

    if (runtime === "workers") {
      apiHealthy = checkInstanceApiHealth();
    } else if (socketReady) {
      try {
        const health = await fetchHealth();
        apiHealthy = health.ok;
      } catch {
        apiHealthy = false;
      }
    }

    const message = recoveryMessage(
      runtime,
      instanceDetail,
      socketReady,
      apiHealthy,
    );

    onUpdate({
      active: true,
      reason,
      message,
      instanceDetail,
      socketReady,
      apiHealthy,
      stack,
    });

    const ready = runtime === "workers"
      ? apiHealthy
      : socketReady && apiHealthy;
    if (ready) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, RECOVERY_POLL_MS));
  }

  return false;
}

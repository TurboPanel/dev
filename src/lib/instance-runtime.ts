import {
  bootstrapOrchestration,
  readInstanceRuntime as readInstanceRuntimeFromEnv,
  runSudo,
  writeDaemonEnv,
} from "@turbopanel/lib/daemon-lifecycle.ts";
import {
  runInstanceLaunchRefresh,
  runPostgresSetupWithExpose,
} from "@turbopanel/lib/daemon-orchestration.ts";
import { ensureWorkersDevVars } from "@turbopanel/lib/workers-dev-vars.ts";
import { ensureWebsiteSystemdUnit } from "@turbopanel/lib/ensure-website-systemd.ts";

export function readInstanceRuntime(): "deno" | "workers" {
  return readInstanceRuntimeFromEnv();
}

export async function switchInstanceRuntime(
  target: "deno" | "workers",
  onEvent?: (event: unknown) => void,
): Promise<void> {
  writeDaemonEnv({ TURBOPANEL_INSTANCE_RUNTIME: target });

  await bootstrapOrchestration();
  await runPostgresSetupWithExpose(target === "workers", onEvent);
  await runInstanceLaunchRefresh(target, onEvent);
  await ensureWebsiteSystemdUnit();

  if (target === "workers") {
    await ensureWorkersDevVars();
    const code = await runSudo(["systemctl", "restart", "turbopanel-instance"]);
    if (code !== 0) {
      throw new Error("failed to start turbopanel-instance (Workers/wrangler)");
    }
  } else {
    const code = await runSudo(["systemctl", "start", "turbopanel-instance"]);
    if (code !== 0) {
      throw new Error("failed to start turbopanel-instance");
    }
  }

  const daemonCode = await runSudo(["systemctl", "restart", "turbopanel-daemon"]);
  if (daemonCode !== 0) {
    throw new Error("failed to restart turbopanel-daemon");
  }
}

import { resetDevInstance } from "@turbopanel/lib/instance-client.ts";
import { isInstanceUnavailableError, waitForInstanceRecovery } from "@turbopanel/lib/instance-recovery.ts";
import {
  readInstanceRuntime,
  switchInstanceRuntime,
} from "@turbopanel/lib/instance-runtime.ts";
import type { TaskStepHandler } from "@turbopanel/lib/daemon-lifecycle.ts";
import { ensureWorkersDevVars } from "@turbopanel/lib/workers-dev-vars.ts";

const STEP_SWITCH_RUNTIME = "step:switch-runtime";
const STEP_REFRESH_WORKERS_VARS = "step:refresh-workers-vars";
const STEP_RESET_DATABASE = "step:reset-database";
const STEP_WAIT_RECOVERY = "step:wait-recovery";

function runtimeLabel(target: "deno" | "workers"): string {
  return target === "deno"
    ? "self-hosted Deno"
    : "Cloudflare Workers (wrangler dev)";
}

export async function resetDevEnvironment(
  target: "deno" | "workers",
  handlers?: {
    onEvent?: (event: unknown) => void;
    onStep?: TaskStepHandler;
  },
): Promise<void> {
  const { onEvent, onStep } = handlers ?? {};

  const emit = (
    id: string,
    label: string,
    status: "running" | "ok" | "failed",
  ) => onStep?.(label, status, id);

  const current = readInstanceRuntime();
  if (current !== target) {
    emit(
      STEP_SWITCH_RUNTIME,
      `Switch to ${runtimeLabel(target)} runtime`,
      "running",
    );
    try {
      await switchInstanceRuntime(target, onEvent);
      emit(
        STEP_SWITCH_RUNTIME,
        `Switch to ${runtimeLabel(target)} runtime`,
        "ok",
      );
    } catch (err) {
      emit(
        STEP_SWITCH_RUNTIME,
        `Switch to ${runtimeLabel(target)} runtime`,
        "failed",
      );
      throw err;
    }
  } else if (target === "workers") {
    emit(STEP_REFRESH_WORKERS_VARS, "Refresh Workers dev vars", "running");
    try {
      await ensureWorkersDevVars();
      emit(STEP_REFRESH_WORKERS_VARS, "Refresh Workers dev vars", "ok");
    } catch (err) {
      emit(STEP_REFRESH_WORKERS_VARS, "Refresh Workers dev vars", "failed");
      throw err;
    }
  }

  emit(STEP_RESET_DATABASE, "Reset database", "running");
  try {
    await resetDevInstance();
    emit(STEP_RESET_DATABASE, "Reset database", "ok");
  } catch (err) {
    if (!isInstanceUnavailableError(err)) {
      emit(STEP_RESET_DATABASE, "Reset database", "failed");
      throw err;
    }
    emit(STEP_RESET_DATABASE, "Reset database", "ok");
  }

  emit(STEP_WAIT_RECOVERY, "Wait for instance recovery", "running");
  const ready = await waitForInstanceRecovery(
    "dev environment reset",
    (snapshot) => {
      emit(STEP_WAIT_RECOVERY, snapshot.message, "running");
    },
  );

  if (!ready) {
    emit(STEP_WAIT_RECOVERY, "Wait for instance recovery", "failed");
    throw new Error(
      "Instance did not recover within 2 minutes — check journalctl -u turbopanel-instance",
    );
  }

  emit(STEP_WAIT_RECOVERY, "Instance is back online", "ok");
}

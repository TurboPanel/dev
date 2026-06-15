import { promptConfirm, promptRuntimeTarget } from "@turbopanel/cli-prompt";
import { resetDevInstance } from "@turbopanel/instance-client";
import { isInstanceUnavailableError, waitForInstanceRecovery } from "@turbopanel/instance-recovery";
import {
  readInstanceRuntime,
  switchInstanceRuntime,
} from "@turbopanel/instance-runtime";
import { ensureWorkersDevVars } from "@turbopanel/workers-dev-vars";

function runtimeLabel(target: "deno" | "workers"): string {
  return target === "deno"
    ? "self-hosted Deno"
    : "Cloudflare Workers (wrangler dev)";
}

export async function resetDevEnvironment(): Promise<void> {
  const target = await promptRuntimeTarget();
  if (!target) {
    console.log("Cancelled.");
    return;
  }

  const confirmed = await promptConfirm(
    "This wipes all Postgres data and restarts the instance. Continue?",
  );
  if (!confirmed) {
    console.log("Cancelled.");
    return;
  }

  const current = readInstanceRuntime();
  if (current !== target) {
    console.log(`Switching to ${runtimeLabel(target)} runtime…`);
    await switchInstanceRuntime(target);
  } else if (target === "workers") {
    await ensureWorkersDevVars();
  }

  console.log("Resetting database…");
  let resetAccepted = false;
  try {
    await resetDevInstance();
    resetAccepted = true;
  } catch (err) {
    if (!isInstanceUnavailableError(err)) {
      throw err;
    }
  }

  console.log(
    resetAccepted
      ? "Database wiped — waiting for instance to restart…"
      : "Instance is restarting after reset — waiting…",
  );

  const ready = await waitForInstanceRecovery(
    "dev environment reset",
    (snapshot) => {
      console.log(snapshot.message);
    },
  );

  if (!ready) {
    throw new Error(
      "Instance did not recover within 2 minutes — check journalctl -u turbopanel-instance",
    );
  }

  console.log(
    `Development environment reset complete — running ${runtimeLabel(target)} with a fresh database.`,
  );
}

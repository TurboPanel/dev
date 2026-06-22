import { writeDaemonInstanceEnv } from "./daemon-env.ts";
import { requestDaemonRestart } from "./daemon-actions.ts";
import { runOrchestrationAction } from "./instance-install.ts";
import { type InstallOutputHandler, runCaptured } from "./install-output.ts";

async function runSystemctl(
  args: string[],
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const code = await runCaptured(["sudo", "-n", "systemctl", ...args], onOutput);
  if (code !== 0) {
    throw new Error(`systemctl ${args.join(" ")} failed`);
  }
}

function runtimePlaybookExtraArgs(target: "deno" | "workers"): string[] {
  return [
    "-e",
    `turbopanel_instance_runtime=${target}`,
    "-e",
    `postgres_expose_port=${target === "workers"}`,
  ];
}

export async function switchInstanceRuntime(
  target: "deno" | "workers",
  onOutput?: InstallOutputHandler,
): Promise<void> {
  // URL/CA keys for workers mode (and their removal for deno) are applied by
  // writeDaemonInstanceEnv() from the resolved runtime.
  writeDaemonInstanceEnv({ TURBOPANEL_INSTANCE_RUNTIME: target });

  const playbookExtra = runtimePlaybookExtraArgs(target);

  onOutput?.(`Switching instance to ${target} mode…`);
  await runOrchestrationAction(
    [
      "playbook",
      "postgres-setup.yml",
      "-e",
      `postgres_expose_port=${target === "workers"}`,
    ],
    () => {},
    onOutput,
  );
  await runOrchestrationAction(
    ["playbook", "instance-launch-only.yml", ...playbookExtra],
    () => {},
    onOutput,
  );

  if (target === "workers") {
    await runSystemctl(["restart", "turbopanel-instance"], onOutput);
    await runSystemctl(["restart", "turbopanel-caddy"], onOutput);
  } else {
    await runSystemctl(["start", "turbopanel-instance"], onOutput);
    await runSystemctl(["restart", "turbopanel-caddy"], onOutput);
  }

  await requestDaemonRestart(onOutput);
  onOutput?.(`Instance runtime switched to ${target}`);
}

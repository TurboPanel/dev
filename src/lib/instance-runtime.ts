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

export async function switchInstanceRuntime(
  target: "deno" | "workers",
  onOutput?: InstallOutputHandler,
): Promise<void> {
  writeDaemonInstanceEnv({ TURBOPANEL_INSTANCE_RUNTIME: target });

  const exposePort = target === "workers";
  const runtimeArg = `-e turbopanel_instance_runtime=${target}`;
  const postgresArg = `-e postgres_expose_port=${exposePort}`;

  onOutput?.(`Switching instance to ${target} mode…`);
  await runOrchestrationAction(
    ["playbook", "postgres-setup.yml", postgresArg],
    () => {},
    onOutput,
  );
  await runOrchestrationAction(
    ["playbook", "instance-launch-only.yml", runtimeArg, postgresArg],
    () => {},
    onOutput,
  );

  if (target === "workers") {
    await runSystemctl(["restart", "turbopanel-instance"], onOutput);
  } else {
    await runSystemctl(["start", "turbopanel-instance"], onOutput);
  }

  await requestDaemonRestart(onOutput);
  onOutput?.(`Instance runtime switched to ${target}`);
}

import { spawnSync } from "node:child_process";
import { writeDaemonInstanceEnv } from "./daemon-env.ts";
import { requestDaemonRestart } from "./daemon-actions.ts";
import { LogFileTailer } from "./log-file-tail.ts";
import { runOrchestrationAction } from "./instance-install.ts";
import { type InstallOutputHandler, runCaptured } from "./install-output.ts";
import {
  consoleLogLine,
  queryServiceActiveState,
  type ConsoleLogLine,
} from "./service-restart.ts";
import { SERVICE_FILE_LOG_PATHS } from "./service-log.ts";

async function runSystemctl(
  args: string[],
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const code = await runCaptured(["sudo", "-n", "systemctl", ...args], onOutput);
  if (code !== 0) {
    throw new Error(`systemctl ${args.join(" ")} failed`);
  }
}

function isSystemdUnitInstalled(unit: string): boolean {
  const result = spawnSync(
    "systemctl",
    ["show", unit, "--property=LoadState", "--value"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  if (result.status !== 0) {
    return false;
  }
  const loadState = (result.stdout ?? "").trim();
  return loadState === "loaded" || loadState === "masked";
}

async function ensureMailpitRunning(onOutput?: InstallOutputHandler): Promise<void> {
  if (!isSystemdUnitInstalled("turbopanel-mailpit")) {
    return;
  }
  await runSystemctl(["enable", "--now", "turbopanel-mailpit"], onOutput);
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

  await ensureMailpitRunning(onOutput);

  // instance-launch-only handlers already restart turbopanel-instance when runtime
  // unit/env templates change; start is a no-op if already active (restart would
  // boot wrangler a second time on workers switches).
  await runSystemctl(["start", "turbopanel-instance"], onOutput);
  await runSystemctl(["restart", "turbopanel-caddy"], onOutput);

  await requestDaemonRestart(onOutput);
  onOutput?.(`Instance runtime switched to ${target}`);
}

const RUNTIME_SWITCH_TIMEOUT_MS = 120_000;
const RUNTIME_SWITCH_POLL_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runtimeSwitchLabel(from: "deno" | "workers", target: "deno" | "workers"): {
  stop: string;
  start: string;
} {
  if (from === "deno" && target === "workers") {
    return {
      stop: "Stopping Deno self-hosted instance…",
      start: "Starting Wrangler dev server…",
    };
  }
  if (from === "workers" && target === "deno") {
    return {
      stop: "Stopping Wrangler dev server…",
      start: "Starting Deno self-hosted instance…",
    };
  }
  return {
    stop: `Stopping ${from} instance runtime…`,
    start: `Starting ${target} instance runtime…`,
  };
}

export async function watchInstanceRuntimeSwitch(
  target: "deno" | "workers",
  from: "deno" | "workers",
  onLog: (line: ConsoleLogLine) => void,
): Promise<void> {
  const labels = runtimeSwitchLabel(from, target);
  const logPaths = SERVICE_FILE_LOG_PATHS.instance ?? [];
  const logTailer = logPaths.length > 0 ? new LogFileTailer(logPaths) : null;

  const drainServiceLogs = () => {
    logTailer?.drain((line) => {
      onLog(consoleLogLine(line));
    });
  };

  onLog(consoleLogLine(`[console] Switching instance runtime: ${from} → ${target}`));
  onLog(consoleLogLine(`[console] ${labels.stop}`));

  const onOutput: InstallOutputHandler = (line) => {
    onLog(consoleLogLine(line));
    drainServiceLogs();
  };

  await switchInstanceRuntime(target, onOutput);
  onLog(consoleLogLine(`[console] ${labels.start}`));

  const started = Date.now();
  while (Date.now() - started < RUNTIME_SWITCH_TIMEOUT_MS) {
    drainServiceLogs();
    const state = queryServiceActiveState("instance");
    if (state === "active") {
      drainServiceLogs();
      onLog(consoleLogLine(
        `[console] turbopanel-instance is active (${target === "workers" ? "Wrangler" : "Deno"})`,
      ));
      return;
    }
    await sleep(RUNTIME_SWITCH_POLL_MS);
  }

  drainServiceLogs();
  const finalState = queryServiceActiveState("instance");
  onLog(consoleLogLine(
    `[console] turbopanel-instance did not become active (last state: ${finalState})`,
  ));
}

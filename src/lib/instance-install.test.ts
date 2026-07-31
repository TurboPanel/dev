import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  DEV_ENV_CONVERGE_STEP,
  installDevEnvironment,
  type InstallDevEnvironmentDeps,
} from "./instance-install.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

type Call = { name: string; args?: unknown };

function makeDeps(
  overrideFactory: (calls: Call[]) => Partial<InstallDevEnvironmentDeps> = () => ({}),
): {
  deps: InstallDevEnvironmentDeps;
  calls: Call[];
} {
  const calls: Call[] = [];
  const deps: InstallDevEnvironmentDeps = {
    ensureDevUserDockerAccess: async () => {
      calls.push({ name: "ensureDevUserDockerAccess" });
      return false;
    },
    runOrchestrationAction: async (actionArgs) => {
      calls.push({ name: "runOrchestrationAction", args: actionArgs });
    },
    writeDaemonInstanceEnv: () => {
      calls.push({ name: "writeDaemonInstanceEnv" });
    },
    isDaemonSystemdInstalled: () => {
      calls.push({ name: "isDaemonSystemdInstalled" });
      return true;
    },
    installDaemonSystemd: async () => {
      calls.push({ name: "installDaemonSystemd" });
    },
    isDaemonServiceActive: () => {
      calls.push({ name: "isDaemonServiceActive" });
      return true;
    },
    requestDaemonRestart: async () => {
      calls.push({ name: "requestDaemonRestart" });
    },
    enableAndStartDaemon: async () => {
      calls.push({ name: "enableAndStartDaemon" });
    },
    ...overrideFactory(calls),
  };
  return { deps, calls };
}

test("failed Ansible converge must not write TURBOPANEL_DEV_INSTANCE opt-in", async () => {
  const { deps, calls } = makeDeps((calls) => ({
    runOrchestrationAction: async () => {
      calls.push({ name: "runOrchestrationAction" });
      throw new Error("Install Docker via geerlingguy.docker Galaxy role");
    },
  }));

  await expect(
    installDevEnvironment(() => {}, undefined, undefined, deps),
  ).rejects.toThrow(/geerlingguy\.docker/);

  expect(calls.map((call) => call.name)).toEqual([
    "ensureDevUserDockerAccess",
    "runOrchestrationAction",
  ]);
  expect(calls.some((call) => call.name === "writeDaemonInstanceEnv")).toBe(false);
  expect(calls.some((call) => call.name === "requestDaemonRestart")).toBe(false);
});

test("successful converge writes opt-in only after Ansible, then restarts daemon", async () => {
  const { deps, calls } = makeDeps();
  const steps: Array<{ label: string; status: string }> = [];

  await installDevEnvironment(
    () => {},
    undefined,
    (label, status) => {
      steps.push({ label, status });
    },
    deps,
  );

  expect(calls.map((call) => call.name)).toEqual([
    "ensureDevUserDockerAccess",
    "runOrchestrationAction",
    "writeDaemonInstanceEnv",
    "isDaemonSystemdInstalled",
    "isDaemonServiceActive",
    "requestDaemonRestart",
  ]);
  expect(steps).toEqual([
    { label: DEV_ENV_CONVERGE_STEP, status: "running" },
    { label: DEV_ENV_CONVERGE_STEP, status: "ok" },
  ]);

  const orchIndex = calls.findIndex((call) => call.name === "runOrchestrationAction");
  const optInIndex = calls.findIndex((call) => call.name === "writeDaemonInstanceEnv");
  const restartIndex = calls.findIndex((call) => call.name === "requestDaemonRestart");
  expect(orchIndex).toBeGreaterThanOrEqual(0);
  expect(optInIndex).toBeGreaterThan(orchIndex);
  expect(restartIndex).toBeGreaterThan(optInIndex);
  expect(calls[orchIndex]?.args).toEqual(["instance-dev-install"]);
});

test("successful converge restores opt-in after systemd unit install", async () => {
  const { deps, calls } = makeDeps((calls) => ({
    isDaemonSystemdInstalled: () => {
      calls.push({ name: "isDaemonSystemdInstalled" });
      return false;
    },
    isDaemonServiceActive: () => {
      calls.push({ name: "isDaemonServiceActive" });
      return false;
    },
  }));

  await installDevEnvironment(() => {}, undefined, undefined, deps);

  expect(calls.map((call) => call.name)).toEqual([
    "ensureDevUserDockerAccess",
    "runOrchestrationAction",
    "writeDaemonInstanceEnv",
    "isDaemonSystemdInstalled",
    "installDaemonSystemd",
    "writeDaemonInstanceEnv",
    "isDaemonServiceActive",
    "enableAndStartDaemon",
  ]);
});

test("instance-install.ts source keeps opt-in after the Ansible try/catch", () => {
  // Belt-and-suspenders: even without running the injectable path, the source
  // must not write TURBOPANEL_DEV_INSTANCE before runOrchestrationAction.
  const source = readFileSync(join(HERE, "instance-install.ts"), "utf8");
  const fnStart = source.indexOf("export async function installDevEnvironment");
  expect(fnStart).toBeGreaterThanOrEqual(0);
  const body = source.slice(fnStart);
  const orch = body.indexOf("runOrchestrationAction");
  const firstOptIn = body.indexOf("writeDaemonInstanceEnv");
  expect(orch).toBeGreaterThanOrEqual(0);
  expect(firstOptIn).toBeGreaterThanOrEqual(0);
  expect(firstOptIn).toBeGreaterThan(orch);
});

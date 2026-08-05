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

type Call = { name: string; args?: unknown; options?: unknown };

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
    ensureOrchestrationDeno: async () => {
      calls.push({ name: "ensureOrchestrationDeno" });
      return "/opt/turbopanel/vendor/deno/current/deno";
    },
    runOrchestrationAction: async (actionArgs, _onEvent, _onOutput, options) => {
      calls.push({ name: "runOrchestrationAction", args: actionArgs, options });
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
    "ensureOrchestrationDeno",
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
    "ensureOrchestrationDeno",
    "ensureDevUserDockerAccess",
    "runOrchestrationAction",
    "writeDaemonInstanceEnv",
    "isDaemonSystemdInstalled",
    "isDaemonServiceActive",
    "requestDaemonRestart",
  ]);
  expect(steps).toEqual([
    { label: "Ensure Deno runtime", status: "running" },
    { label: "Ensure Deno runtime", status: "ok" },
    { label: DEV_ENV_CONVERGE_STEP, status: "running" },
    { label: DEV_ENV_CONVERGE_STEP, status: "ok" },
  ]);

  const orchIndex = calls.findIndex((call) => call.name === "runOrchestrationAction");
  const optInIndex = calls.findIndex((call) => call.name === "writeDaemonInstanceEnv");
  const restartIndex = calls.findIndex((call) => call.name === "requestDaemonRestart");
  expect(orchIndex).toBeGreaterThanOrEqual(0);
  expect(optInIndex).toBeGreaterThan(orchIndex);
  expect(restartIndex).toBeGreaterThan(optInIndex);
  // Default mode is force so legacy callers never inherit skip-by-stamp.
  expect(calls[orchIndex]?.args).toEqual(["instance-dev-install"]);
  expect(calls[orchIndex]?.options).toEqual({
    denoBin: "/opt/turbopanel/vendor/deno/current/deno",
    mode: "force",
  });
});

test("if-needed mode passes --if-needed and mode option to orchestration", async () => {
  const { deps, calls } = makeDeps();

  await installDevEnvironment(() => {}, undefined, undefined, deps, "if-needed");

  const orch = calls.find((call) => call.name === "runOrchestrationAction");
  expect(orch?.args).toEqual(["instance-dev-install", "--if-needed"]);
  expect(orch?.options).toEqual({
    denoBin: "/opt/turbopanel/vendor/deno/current/deno",
    mode: "if-needed",
  });
});

test("force mode omits --if-needed and passes mode force", async () => {
  const { deps, calls } = makeDeps();

  await installDevEnvironment(() => {}, undefined, undefined, deps, "force");

  const orch = calls.find((call) => call.name === "runOrchestrationAction");
  expect(orch?.args).toEqual(["instance-dev-install"]);
  expect(orch?.options).toEqual({
    denoBin: "/opt/turbopanel/vendor/deno/current/deno",
    mode: "force",
  });
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
    "ensureOrchestrationDeno",
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

test("failed Ensure Deno runtime must not mutate Docker access, run Ansible, or write opt-in", async () => {
  const denoError = new Error("Failed to install Deno");
  const { deps, calls } = makeDeps((calls) => ({
    ensureOrchestrationDeno: async () => {
      calls.push({ name: "ensureOrchestrationDeno" });
      throw denoError;
    },
  }));

  await expect(
    installDevEnvironment(() => {}, undefined, undefined, deps),
  ).rejects.toThrow(denoError);

  expect(calls.map((call) => call.name)).toEqual([
    "ensureOrchestrationDeno",
  ]);
  expect(calls.some((call) => call.name === "ensureDevUserDockerAccess")).toBe(false);
  expect(calls.some((call) => call.name === "runOrchestrationAction")).toBe(false);
  expect(calls.some((call) => call.name === "writeDaemonInstanceEnv")).toBe(false);
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

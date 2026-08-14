import { expect, test } from "vitest";
import {
  resetDevEnvironment,
  type ResetDevEnvironmentDeps,
} from "./reset-dev-environment.ts";

test("resetDevEnvironment always rebuilds with force mode after teardown", async () => {
  const installCalls: Array<{ mode?: "if-needed" | "force" }> = [];
  const shellLabels: string[] = [];
  const resetRepos: string[] = [];

  const deps: ResetDevEnvironmentDeps = {
    runShellStep: async (label, _command, _onOutput, onStep) => {
      shellLabels.push(label);
      onStep(label, "running");
      onStep(label, "ok");
    },
    resetRepo: async (repo, _onOutput, onStep) => {
      resetRepos.push(repo);
      onStep(`Reset repo: ${repo}`, "running");
      onStep(`Reset repo: ${repo}`, "ok");
    },
    installDevEnvironment: async (
      _onEvent,
      _onOutput,
      _onStep,
      _installDeps,
      mode,
    ) => {
      installCalls.push({ mode });
    },
  };

  await resetDevEnvironment(() => {}, () => {}, deps);

  expect(shellLabels).toEqual([
    "Stop platform services",
    "Remove Docker containers",
    "Remove Docker volumes",
  ]);
  expect(resetRepos).toEqual(["turbopaneld", "turbopanel", "ui", "website"]);
  expect(installCalls).toEqual([{ mode: "force" }]);
});

test("reset must not call installDevEnvironment without an explicit force mode", async () => {
  const modes: Array<"if-needed" | "force" | undefined> = [];
  const deps: ResetDevEnvironmentDeps = {
    runShellStep: async () => {},
    resetRepo: async () => {},
    installDevEnvironment: async (
      _onEvent,
      _onOutput,
      _onStep,
      _installDeps,
      mode,
    ) => {
      modes.push(mode);
    },
  };

  await resetDevEnvironment(() => {}, () => {}, deps);

  expect(modes).toHaveLength(1);
  expect(modes[0]).toBe("force");
  expect(modes[0]).not.toBe("if-needed");
  expect(modes[0]).not.toBeUndefined();
});

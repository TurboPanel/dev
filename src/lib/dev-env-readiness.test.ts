import { afterEach, describe, expect, it, test, vi } from "vitest";
import {
  ANSIBLE_PLAYBOOK_BIN,
  daemonRepoPath,
  DEV_CONVERGE_STAMP_PATH,
  VENDORED_DENO_BIN,
} from "./paths.ts";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn((path: string) => actual.existsSync(path)),
  };
});

vi.mock("./daemon-exec.ts", () => ({
  lookupHostDenoBin: vi.fn(() => "/usr/bin/deno"),
}));

vi.mock("./daemon-env.ts", () => ({
  isDevInstanceEnabled: vi.fn(() => true),
}));

vi.mock("../dev-services.ts", () => ({
  isDaemonSystemdInstalled: vi.fn(() => true),
}));

import { existsSync } from "node:fs";
import { lookupHostDenoBin } from "./daemon-exec.ts";
import { isDevInstanceEnabled } from "./daemon-env.ts";
import { isDaemonSystemdInstalled } from "../dev-services.ts";
import {
  CONSOLE_NO_AUTO_CONVERGE_ENV,
  isConsoleAutoConvergeDisabled,
  resolveDevEnvStartupPlan,
  type DevEnvReadinessProbe,
} from "./dev-env-readiness.ts";

const mockedExistsSync = vi.mocked(existsSync);
const mockedLookupHostDeno = vi.mocked(lookupHostDenoBin);
const mockedIsDevInstanceEnabled = vi.mocked(isDevInstanceEnabled);
const mockedIsDaemonSystemdInstalled = vi.mocked(isDaemonSystemdInstalled);

function makeProbe(
  overrides: Partial<DevEnvReadinessProbe> = {},
): DevEnvReadinessProbe {
  return {
    hasDaemonCheckout: () => true,
    hasResolvableDeno: () => true,
    hasOrchestrationRuntime: () => true,
    hasDaemonSystemdUnit: () => true,
    hasDevConvergeStamp: () => true,
    isDevInstanceEnabled: () => true,
    ...overrides,
  };
}

function assertReasons(reasons: string[]): void {
  expect(Array.isArray(reasons)).toBe(true);
  expect(reasons.length).toBeGreaterThan(0);
  for (const reason of reasons) {
    expect(typeof reason).toBe("string");
    expect(reason.length).toBeGreaterThan(0);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const emptyEnv: NodeJS.ProcessEnv = {};

test("fresh host without daemon checkout → bootstrap", () => {
  const plan = resolveDevEnvStartupPlan(
    makeProbe({ hasDaemonCheckout: () => false }),
    emptyEnv,
  );
  expect(plan.action).toBe("bootstrap");
  expect(plan.reasons.some((r) => /checkout/i.test(r))).toBe(true);
  assertReasons(plan.reasons);
});

test("checkout present but no turbopaneld unit → bootstrap", () => {
  const plan = resolveDevEnvStartupPlan(
    makeProbe({ hasDaemonSystemdUnit: () => false }),
    emptyEnv,
  );
  expect(plan.action).toBe("bootstrap");
  expect(plan.reasons.some((r) => /systemd/i.test(r))).toBe(true);
  assertReasons(plan.reasons);
});

test("turbopaneld unit installed but daemon checkout missing → bootstrap", () => {
  const plan = resolveDevEnvStartupPlan(
    makeProbe({
      hasDaemonCheckout: () => false,
      hasDaemonSystemdUnit: () => true,
    }),
    emptyEnv,
  );
  expect(plan.action).toBe("bootstrap");
  expect(plan.reasons.some((r) => /checkout/i.test(r))).toBe(true);
  expect(plan.reasons.some((r) => /systemd/i.test(r))).toBe(false);
  assertReasons(plan.reasons);
});

test("multiple missing bootstrap prerequisites → all reasons returned", () => {
  const plan = resolveDevEnvStartupPlan(
    makeProbe({
      hasDaemonCheckout: () => false,
      hasResolvableDeno: () => false,
      hasOrchestrationRuntime: () => false,
      hasDaemonSystemdUnit: () => false,
    }),
    emptyEnv,
  );
  expect(plan.action).toBe("bootstrap");
  expect(plan.reasons.some((r) => /checkout/i.test(r))).toBe(true);
  expect(plan.reasons.some((r) => /Deno/i.test(r))).toBe(true);
  expect(plan.reasons.some((r) => /orchestration|ansible/i.test(r))).toBe(true);
  expect(plan.reasons.some((r) => /systemd/i.test(r))).toBe(true);
  expect(plan.reasons).toHaveLength(4);
  assertReasons(plan.reasons);
});

test("missing Deno only → bootstrap", () => {
  const plan = resolveDevEnvStartupPlan(
    makeProbe({ hasResolvableDeno: () => false }),
    emptyEnv,
  );
  expect(plan.action).toBe("bootstrap");
  expect(plan.reasons.some((r) => /Deno/i.test(r))).toBe(true);
  assertReasons(plan.reasons);
});

test("missing orchestration runtime only → bootstrap", () => {
  const plan = resolveDevEnvStartupPlan(
    makeProbe({ hasOrchestrationRuntime: () => false }),
    emptyEnv,
  );
  expect(plan.action).toBe("bootstrap");
  expect(plan.reasons.some((r) => /orchestration|ansible/i.test(r))).toBe(true);
  assertReasons(plan.reasons);
});

test("all four present, no converge stamp → idle (no auto-converge)", () => {
  const plan = resolveDevEnvStartupPlan(
    makeProbe({ hasDevConvergeStamp: () => false }),
    emptyEnv,
  );
  expect(plan.action).toBe("idle");
  expect(plan.reasons.some((r) => /no prior.*stamp/i.test(r))).toBe(true);
  expect(plan.reasons.some((r) => /auto-converge disabled/i.test(r))).toBe(true);
  assertReasons(plan.reasons);
});

test("fully ready host → idle (no auto-converge on launch)", () => {
  const plan = resolveDevEnvStartupPlan(makeProbe(), emptyEnv);
  expect(plan.action).toBe("idle");
  expect(plan.reasons.some((r) => /previously completed/i.test(r))).toBe(true);
  expect(plan.reasons.some((r) => /auto-converge disabled/i.test(r))).toBe(true);
  assertReasons(plan.reasons);
});

test("TURBOPANEL_CONSOLE_NO_AUTO_CONVERGE is legacy and does not change idle", () => {
  const plan = resolveDevEnvStartupPlan(makeProbe(), {
    [CONSOLE_NO_AUTO_CONVERGE_ENV]: "1",
  });
  expect(plan.action).toBe("idle");
  assertReasons(plan.reasons);
});

test("TURBOPANEL_CONSOLE_NO_AUTO_CONVERGE does not block bootstrap", () => {
  const plan = resolveDevEnvStartupPlan(
    makeProbe({ hasDaemonCheckout: () => false }),
    { [CONSOLE_NO_AUTO_CONVERGE_ENV]: "1" },
  );
  expect(plan.action).toBe("bootstrap");
});

test("isConsoleAutoConvergeDisabled treats any non-empty value as set", () => {
  expect(isConsoleAutoConvergeDisabled({})).toBe(false);
  expect(isConsoleAutoConvergeDisabled({ [CONSOLE_NO_AUTO_CONVERGE_ENV]: "" })).toBe(
    false,
  );
  expect(
    isConsoleAutoConvergeDisabled({ [CONSOLE_NO_AUTO_CONVERGE_ENV]: "   " }),
  ).toBe(false);
  expect(
    isConsoleAutoConvergeDisabled({ [CONSOLE_NO_AUTO_CONVERGE_ENV]: "1" }),
  ).toBe(true);
});

test("idle records missing opt-in and a present converge stamp", () => {
  const plan = resolveDevEnvStartupPlan(
    makeProbe({ isDevInstanceEnabled: () => false, hasDevConvergeStamp: () => true }),
    emptyEnv,
  );
  expect(plan.action).toBe("idle");
  expect(plan.action).not.toBe("converge");
  expect(plan.reasons.some((r) => /opt-in not set/.test(r))).toBe(true);
  expect(plan.reasons.some((r) => /previously completed/.test(r))).toBe(true);
  assertReasons(plan.reasons);
});

test("isConsoleAutoConvergeDisabled reads process.env when no env is passed", () => {
  vi.stubEnv(CONSOLE_NO_AUTO_CONVERGE_ENV, "yes");
  expect(isConsoleAutoConvergeDisabled()).toBe(true);
  vi.stubEnv(CONSOLE_NO_AUTO_CONVERGE_ENV, "");
  expect(isConsoleAutoConvergeDisabled()).toBe(false);
});

describe("default readiness probes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mockedExistsSync.mockReset();
    mockedLookupHostDeno.mockReset();
    mockedIsDevInstanceEnabled.mockReset();
    mockedIsDaemonSystemdInstalled.mockReset();
    mockedLookupHostDeno.mockReturnValue("/usr/bin/deno");
    mockedIsDevInstanceEnabled.mockReturnValue(true);
    mockedIsDaemonSystemdInstalled.mockReturnValue(true);
  });

  it("bootstraps when default filesystem probes miss checkout/ansible/deno/unit", () => {
    mockedLookupHostDeno.mockReturnValue(null);
    mockedIsDaemonSystemdInstalled.mockReturnValue(false);
    mockedExistsSync.mockReturnValue(false);

    const plan = resolveDevEnvStartupPlan();
    expect(plan.action).toBe("bootstrap");
    expect(plan.reasons).toHaveLength(4);
    assertReasons(plan.reasons);
  });

  it("treats host Deno as enough even when the vendored binary is absent", () => {
    mockedLookupHostDeno.mockReturnValue("/usr/bin/deno");
    mockedIsDaemonSystemdInstalled.mockReturnValue(true);
    mockedIsDevInstanceEnabled.mockReturnValue(false);
    mockedExistsSync.mockImplementation((path) => {
      const p = String(path);
      if (p === VENDORED_DENO_BIN) return false;
      return (
        p === daemonRepoPath() ||
        p === ANSIBLE_PLAYBOOK_BIN ||
        p === DEV_CONVERGE_STAMP_PATH
      );
    });

    const plan = resolveDevEnvStartupPlan();
    expect(plan.action).toBe("idle");
    expect(plan.reasons.some((r) => /opt-in not set/.test(r))).toBe(true);
  });

  it("resolves Deno from the vendored current binary when PATH is empty", () => {
    mockedLookupHostDeno.mockReturnValue(null);
    mockedIsDaemonSystemdInstalled.mockReturnValue(true);
    mockedExistsSync.mockImplementation((path) => {
      const p = String(path);
      return (
        p === daemonRepoPath() ||
        p === VENDORED_DENO_BIN ||
        p === ANSIBLE_PLAYBOOK_BIN ||
        p === DEV_CONVERGE_STAMP_PATH
      );
    });

    const plan = resolveDevEnvStartupPlan();
    expect(plan.action).toBe("idle");
  });

  it("maps existsSync throws to missing probes", () => {
    mockedLookupHostDeno.mockReturnValue(null);
    mockedIsDaemonSystemdInstalled.mockReturnValue(false);
    mockedExistsSync.mockImplementation(() => {
      throw new Error("EACCES");
    });

    const plan = resolveDevEnvStartupPlan();
    expect(plan.action).toBe("bootstrap");
    expect(plan.reasons).toEqual([
      "daemon checkout missing",
      "Deno runtime not resolvable",
      "orchestration runtime (ansible) not installed",
      "turbopaneld systemd unit not installed",
    ]);
  });
});


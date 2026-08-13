import { expect, test } from "vitest";
import {
  CONSOLE_NO_AUTO_CONVERGE_ENV,
  isConsoleAutoConvergeDisabled,
  resolveDevEnvStartupPlan,
  type DevEnvReadinessProbe,
} from "./dev-env-readiness.ts";

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

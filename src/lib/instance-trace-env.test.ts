import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const tempDirs: string[] = [];
let runtimeEnvPath = "";
let runtimeDevVarsPath = "";

vi.mock("./paths.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./paths.ts")>();
  return {
    ...actual,
    instanceRuntimeEnvPath: () => runtimeEnvPath,
    instanceRuntimeDevVarsPath: () => runtimeDevVarsPath,
  };
});

import {
  cellTraceToggleLabel,
  readCellTraceEnabled,
  setCellTraceEnabled,
} from "./instance-trace-env.ts";

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "tp-cell-trace-env-"));
  tempDirs.push(dir);
  runtimeEnvPath = join(dir, "runtime.env");
  runtimeDevVarsPath = join(dir, "runtime.dev-vars");
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readCellTraceEnabled is false when neither file sets the key", () => {
  writeFileSync(runtimeEnvPath, "OTHER=1\n");
  writeFileSync(runtimeDevVarsPath, "FOO=bar\n");
  expect(readCellTraceEnabled()).toBe(false);
  expect(cellTraceToggleLabel()).toBe("Enable verbose cell trace");
});

test("readCellTraceEnabled prefers runtime.env over runtime.dev-vars", () => {
  writeFileSync(runtimeEnvPath, "TURBOPANEL_DAEMON_DEBUG=0\n");
  writeFileSync(runtimeDevVarsPath, "TURBOPANEL_DAEMON_DEBUG=1\n");
  expect(readCellTraceEnabled()).toBe(false);

  writeFileSync(runtimeEnvPath, "TURBOPANEL_DAEMON_DEBUG=true\n");
  expect(readCellTraceEnabled()).toBe(true);
  expect(cellTraceToggleLabel()).toBe("Disable verbose cell trace");
});

test("readCellTraceEnabled falls back to runtime.dev-vars", () => {
  writeFileSync(runtimeEnvPath, "KEEP=1\n");
  writeFileSync(runtimeDevVarsPath, "TURBOPANEL_DAEMON_DEBUG=1\n");
  expect(readCellTraceEnabled()).toBe(true);
});

test("setCellTraceEnabled writes both files and clears both when disabled", () => {
  writeFileSync(runtimeEnvPath, "KEEP=yes\n");
  writeFileSync(runtimeDevVarsPath, "KEEP=yes\n");

  setCellTraceEnabled(true);
  expect(readFileSync(runtimeEnvPath, "utf8")).toContain(
    "TURBOPANEL_DAEMON_DEBUG=1",
  );
  expect(readFileSync(runtimeDevVarsPath, "utf8")).toContain(
    "TURBOPANEL_DAEMON_DEBUG=1",
  );
  expect(readCellTraceEnabled()).toBe(true);

  setCellTraceEnabled(false);
  expect(readFileSync(runtimeEnvPath, "utf8")).not.toContain(
    "TURBOPANEL_DAEMON_DEBUG",
  );
  expect(readFileSync(runtimeDevVarsPath, "utf8")).not.toContain(
    "TURBOPANEL_DAEMON_DEBUG",
  );
  expect(readFileSync(runtimeEnvPath, "utf8")).toContain("KEEP=yes");
  expect(readCellTraceEnabled()).toBe(false);
});

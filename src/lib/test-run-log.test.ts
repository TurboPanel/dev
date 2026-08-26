import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { openTestRunLog } from "./test-run-log.ts";
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

test("openTestRunLog writes header lines and persists body until close", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-test-run-log-"));
  tempDirs.push(dir);
  const path = join(dir, "runs", "ui-test.log");

  const handle = await openTestRunLog("ui", "test", {
    resolvePath: () => path,
  });
  if (handle === null) {
    throw new TypeError("expected openTestRunLog to return a handle");
  }

  expect(handle.path).toBe(path);
  handle.writeLine("ok line");
  await handle.close();

  const text = readFileSync(path, "utf8");
  expect(text).toContain("# turbopanel console test run");
  expect(text).toContain("# repo=ui");
  expect(text).toContain("# suite=test");
  expect(text).toContain("ok line");
});

test("openTestRunLog ignores writes after close", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-test-run-log-"));
  tempDirs.push(dir);
  const path = join(dir, "suite.log");

  const handle = await openTestRunLog("dev", "typecheck", {
    resolvePath: () => path,
  });
  if (handle === null) {
    throw new TypeError("expected openTestRunLog to return a handle");
  }

  await handle.close();
  handle.writeLine("should not appear");
  await handle.close();

  expect(readFileSync(path, "utf8")).not.toContain("should not appear");
});

test("openTestRunLog returns null when mkdir fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-test-run-log-"));
  tempDirs.push(dir);
  const blocker = join(dir, "not-a-directory");
  writeFileSync(blocker, "x");
  const handle = await openTestRunLog("ui", "test", {
    resolvePath: () => join(blocker, "nested", "run.log"),
  });
  expect(handle).toBeNull();
});
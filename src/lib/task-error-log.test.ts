import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";

const taskErrorPathRef = { path: join(tmpdir(), "tp-task-error-placeholder.log") };

vi.mock("./paths.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./paths.ts")>();
  return {
    ...actual,
    get CONSOLE_LAST_TASK_ERROR_LOG() {
      return taskErrorPathRef.path;
    },
  };
});

vi.mock("./spawn-trusted.ts", () => ({
  spawnSyncTrusted: vi.fn(() => ({
    status: 1,
    stdout: "",
    stderr: "",
    pid: 0,
    output: [],
    signal: null,
  })),
}));

import { spawnSyncTrusted } from "./spawn-trusted.ts";
import {
  formatTaskErrorLog,
  writeTaskErrorLog,
  type TaskErrorRecord,
} from "./task-error-log.ts";

const mockedSpawnSyncTrusted = vi.mocked(spawnSyncTrusted);
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  mockedSpawnSyncTrusted.mockReset();
  mockedSpawnSyncTrusted.mockReturnValue({
    status: 1,
    stdout: "",
    stderr: "",
    pid: 0,
    output: [],
    signal: null,
  });
});

function sampleRecord(
  extras: Partial<TaskErrorRecord> = {},
): TaskErrorRecord {
  return {
    title: "Converge failed",
    message: "playbook exited 2",
    timestamp: "2026-08-25T18:00:00.000Z",
    ...extras,
  };
}

test("formatTaskErrorLog writes time, title, message, and log path", () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-task-error-"));
  tempDirs.push(dir);
  taskErrorPathRef.path = join(dir, "last-task-error.log");
  const body = formatTaskErrorLog(sampleRecord());
  expect(body).toContain("time=2026-08-25T18:00:00.000Z");
  expect(body).toContain("title=Converge failed");
  expect(body).toContain("playbook exited 2");
  expect(body).toContain(`log=${taskErrorPathRef.path}`);
  expect(body).not.toContain("tasks:");
});

test("formatTaskErrorLog includes recap and task rows when present", () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-task-error-recap-"));
  tempDirs.push(dir);
  taskErrorPathRef.path = join(dir, "last-task-error.log");
  const body = formatTaskErrorLog(
    sampleRecord({
      recap: "3 failed",
      tasks: [
        { label: "apt", status: "ok" },
        { label: "caddy", status: "failed" },
      ],
    }),
  );
  expect(body).toContain("3 failed");
  expect(body).toContain("tasks:");
  expect(body).toContain("  [ok] apt");
  expect(body).toContain("  [failed] caddy");
});

test("writeTaskErrorLog writes the formatted body to the log path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-task-error-write-"));
  tempDirs.push(dir);
  taskErrorPathRef.path = join(dir, "nested", "last-task-error.log");
  const record = sampleRecord({ recap: "stopped" });
  await expect(writeTaskErrorLog(record)).resolves.toBe(true);
  expect(readFileSync(taskErrorPathRef.path, "utf8")).toBe(
    formatTaskErrorLog(record),
  );
  expect(mockedSpawnSyncTrusted).not.toHaveBeenCalled();
});

test("writeTaskErrorLog falls back to sudo when the path is not writable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-task-error-sudo-"));
  tempDirs.push(dir);
  const blocker = join(dir, "not-a-directory");
  writeFileSync(blocker, "x");
  taskErrorPathRef.path = join(blocker, "nested", "last-task-error.log");
  mockedSpawnSyncTrusted.mockReturnValue({
    status: 0,
    stdout: "",
    stderr: "",
    pid: 0,
    output: [],
    signal: null,
  });
  await expect(writeTaskErrorLog(sampleRecord())).resolves.toBe(true);
  expect(mockedSpawnSyncTrusted).toHaveBeenCalled();
  expect(String(mockedSpawnSyncTrusted.mock.calls[0]?.[0])).toBe("/usr/bin/sudo");
});

test("writeTaskErrorLog returns false when sudo fallback also fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-task-error-fail-"));
  tempDirs.push(dir);
  const blocker = join(dir, "not-a-directory");
  writeFileSync(blocker, "x");
  taskErrorPathRef.path = join(blocker, "nested", "last-task-error.log");
  mockedSpawnSyncTrusted.mockReturnValue({
    status: 1,
    stdout: "",
    stderr: "",
    pid: 0,
    output: [],
    signal: null,
  });
  await expect(writeTaskErrorLog(sampleRecord())).resolves.toBe(false);
});

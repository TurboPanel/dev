import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const tempDirs: string[] = [];
const instancePaths: string[] = [];

vi.mock("./service-log.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service-log.ts")>();
  return {
    ...actual,
    SERVICE_FILE_LOG_PATHS: new Proxy(actual.SERVICE_FILE_LOG_PATHS, {
      get(target, prop, receiver) {
        if (prop === "instance") {
          return instancePaths;
        }
        return Reflect.get(target, prop, receiver);
      },
    }),
    readServiceLogFileStat: vi.fn(() => {
      const floor: Record<string, number> = {};
      for (const path of instancePaths) {
        floor[path] = 0;
      }
      return floor;
    }),
  };
});

import {
  readCellTraceLogFileStat,
  readCellTraceLogTail,
} from "./cell-trace-log.ts";
import { readServiceLogFileStat } from "./service-log.ts";

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "tp-cell-trace-log-"));
  tempDirs.push(dir);
  const errPath = join(dir, "instance.err.log");
  const logPath = join(dir, "instance.log");
  writeFileSync(errPath, "");
  writeFileSync(logPath, "");
  instancePaths.splice(0, instancePaths.length, errPath, logPath);
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readCellTraceLogFileStat delegates to instance service stats", () => {
  expect(readCellTraceLogFileStat()).toEqual({
    [instancePaths[0]!]: 0,
    [instancePaths[1]!]: 0,
  });
  expect(readServiceLogFileStat).toHaveBeenCalledWith("instance");
});

test("readCellTraceLogTail returns the empty-state hint when no trace lines exist", () => {
  writeFileSync(
    instancePaths[1]!,
    "2026-08-25T12:00:00.000Z INFO other-component  hello\n",
  );
  const lines = readCellTraceLogTail(50);
  expect(lines).toHaveLength(1);
  expect(lines[0]?.text).toContain("No cell trace lines yet");
});

test("readCellTraceLogTail keeps daemon-cell token and command-consumer lines", () => {
  writeFileSync(
    instancePaths[1]!,
    [
      "noise without structure",
      "plain daemon-cell presence update",
      "2026-08-25T12:00:00.000Z INFO command-consumer  handled ping",
      "2026-08-25T12:00:01.000Z INFO other  ignored",
      "2026-08-25T12:00:02.000Z DEBUG daemon-cell  hibernate",
      "",
    ].join("\n"),
  );

  const lines = readCellTraceLogTail(50);
  expect(lines.map((line) => line.text)).toEqual([
    "plain daemon-cell presence update",
    "INFO command-consumer  handled ping",
    "DEBUG daemon-cell  hibernate",
  ]);
  expect(lines[1]?.time).toBe("2026-08-25T12:00:00.000Z");
});

test("readCellTraceLogTail respects maxLines on the filtered set", () => {
  const rows = Array.from({ length: 5 }, (_, i) =>
    `line-${i} daemon-cell event`
  );
  writeFileSync(instancePaths[1]!, `${rows.join("\n")}\n`);
  const lines = readCellTraceLogTail(2);
  expect(lines).toHaveLength(2);
  expect(lines[0]?.text).toContain("line-3");
  expect(lines[1]?.text).toContain("line-4");
});

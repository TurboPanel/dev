import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./spawn-trusted.ts", () => ({
  spawnSyncTrustedText: vi.fn(),
}));

vi.mock("./docker-access.ts", () => ({
  spawnDocker: vi.fn(() => null),
}));

vi.mock("./install-output.ts", () => ({
  runCaptured: vi.fn(async () => 0),
}));

import { runCaptured } from "./install-output.ts";
import { spawnSyncTrustedText } from "./spawn-trusted.ts";
import { watchServiceRestart, type ConsoleLogLine } from "./service-restart.ts";

const mockedSpawn = vi.mocked(spawnSyncTrustedText);
const mockedRunCaptured = vi.mocked(runCaptured);

function textResult(stdout: string) {
  return { status: 0, stdout, stderr: "", pid: 0, output: ["", stdout, ""], signal: null };
}

/**
 * The unit is installed; each `ActiveState` read pops the next scripted state
 * (the last one repeats). Returns a counter of `ActiveState` reads.
 */
function scriptActiveStates(states: string[]): { reads: () => number } {
  let reads = 0;
  mockedSpawn.mockImplementation((_cmd, args) => {
    const list = args as string[];
    if (list.includes("--property=LoadState")) {
      return textResult("loaded");
    }
    const state = states[Math.min(reads, states.length - 1)] ?? "unknown";
    reads += 1;
    return textResult(state);
  });
  return { reads: () => reads };
}

function collectLines(): { lines: string[]; onLog: (line: ConsoleLogLine) => void } {
  const lines: string[] = [];
  return { lines, onLog: (line) => lines.push(line.text) };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockedSpawn.mockReset();
  mockedRunCaptured.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("watchServiceRestart (systemd)", () => {
  it("polls once per interval and logs each transition exactly once", async () => {
    // Read 1: was active. Reads 2-5: inactive, inactive, activating, active.
    const script = scriptActiveStates(["active", "inactive", "inactive", "activating", "active"]);
    const { lines, onLog } = collectLines();
    const pending = watchServiceRestart("cache", "Cache", onLog, {
      timeoutMs: 5_000,
      pollMs: 200,
    });
    await vi.advanceTimersByTimeAsync(600);
    await expect(pending).resolves.toBe(true);
    expect(script.reads()).toBe(5);
    expect(mockedRunCaptured).toHaveBeenCalledWith([
      "sudo",
      "-n",
      "systemctl",
      "restart",
      "--no-block",
      "turbopanel-redis",
    ]);
    expect(lines).toEqual([
      "[console] requesting restart of cache…",
      "[console] Cache shutting down (systemd: inactive)",
      "[console] Cache stopped",
      "[console] Cache starting up (systemd: activating)",
      "[console] Cache is active",
    ]);
  });

  it("does not check again before the poll interval has elapsed", async () => {
    const script = scriptActiveStates(["active", "inactive", "active"]);
    const pending = watchServiceRestart("cache", "Cache", () => {}, {
      timeoutMs: 5_000,
      pollMs: 200,
    });
    await vi.advanceTimersByTimeAsync(199);
    expect(script.reads()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(true);
    expect(script.reads()).toBe(3);
  });

  it("reports the last state when the deadline passes without becoming active", async () => {
    // Read 1: was active. Loop polls at 0 and 200 ms. Read 4: the final probe.
    const script = scriptActiveStates(["active", "inactive"]);
    const { lines, onLog } = collectLines();
    const pending = watchServiceRestart("cache", "Cache", onLog, {
      timeoutMs: 400,
      pollMs: 200,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toBe(false);
    expect(script.reads()).toBe(4);
    expect(lines.at(-1)).toBe("[console] Cache did not become active (last state: inactive)");
  });

  it("accepts a service that turns active on the final probe after the deadline", async () => {
    // Zero timeout: the loop never runs; read 1 = was active, read 2 = final probe.
    const script = scriptActiveStates(["inactive", "active"]);
    const { lines, onLog } = collectLines();
    await expect(
      watchServiceRestart("cache", "Cache", onLog, { timeoutMs: 0, pollMs: 200 }),
    ).resolves.toBe(true);
    expect(script.reads()).toBe(2);
    expect(lines.at(-1)).toBe("[console] Cache is active");
  });
});

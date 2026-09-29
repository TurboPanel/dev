import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const drain = vi.hoisted(() => vi.fn());

vi.mock("./daemon-env.ts", () => ({ writeDaemonInstanceEnv: vi.fn() }));
vi.mock("./daemon-actions.ts", () => ({ requestDaemonRestart: vi.fn(async () => {}) }));
vi.mock("./instance-install.ts", () => ({ runOrchestrationAction: vi.fn(async () => {}) }));
vi.mock("./install-output.ts", () => ({ runCaptured: vi.fn(async () => 0) }));
vi.mock("./spawn-trusted.ts", () => ({
  spawnSyncTrustedText: vi.fn(() => ({ status: 1, stdout: "" })),
}));
vi.mock("./log-file-tail.ts", () => ({
  LogFileTailer: class {
    drain = drain;
  },
}));
vi.mock("./service-restart.ts", () => ({
  queryServiceActiveState: vi.fn(),
  consoleLogLine: (text: string) => ({ text, time: "now" }),
}));

import { watchInstanceRuntimeSwitch } from "./instance-runtime.ts";
import { queryServiceActiveState } from "./service-restart.ts";

const mockedState = vi.mocked(queryServiceActiveState);

/** `queryServiceActiveState` returns `active` from the `n`th call on (1-based). */
function activeFromQuery(n: number): void {
  let calls = 0;
  mockedState.mockImplementation(() => {
    calls += 1;
    return calls >= n ? "active" : "activating";
  });
}

function collect(): { lines: string[]; onLog: (line: { text: string }) => void } {
  const lines: string[] = [];
  return { lines, onLog: (line) => lines.push(line.text) };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockedState.mockReset();
  drain.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("watchInstanceRuntimeSwitch", () => {
  it("polls every 500 ms and stops at the first active reading", async () => {
    activeFromQuery(3);
    const { lines, onLog } = collect();
    const pending = watchInstanceRuntimeSwitch("deno", "workers", onLog as never);
    await vi.advanceTimersByTimeAsync(499);
    expect(mockedState).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockedState).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(mockedState).toHaveBeenCalledTimes(3);
    expect(lines.at(-1)).toBe("[console] turbopanel-instance is active (Deno)");
    expect(lines.some((line) => line.includes("did not become active"))).toBe(false);
  });

  it("names Wrangler when switching to workers", async () => {
    activeFromQuery(1);
    const { lines, onLog } = collect();
    await watchInstanceRuntimeSwitch("workers", "deno", onLog as never);
    expect(lines.at(-1)).toBe("[console] turbopanel-instance is active (Wrangler)");
  });

  it("logs the last state when the instance never becomes active in 120 s", async () => {
    mockedState.mockReturnValue("failed");
    const { lines, onLog } = collect();
    const pending = watchInstanceRuntimeSwitch("deno", "workers", onLog as never);
    await vi.advanceTimersByTimeAsync(130_000);
    await pending;
    // 240 polls at 0, 500 ... 119 500 ms, then one final reading.
    expect(mockedState).toHaveBeenCalledTimes(241);
    expect(lines.at(-1)).toBe(
      "[console] turbopanel-instance did not become active (last state: failed)",
    );
  });
});

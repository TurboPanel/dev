import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceLogLine } from "../lib/service-log.ts";
import { mountHook, type MountedHook } from "./ink-hook-render.ts";
import { pickCellTraceLines, useCellTraceLog } from "./use-cell-trace-log.ts";

vi.mock("../lib/cell-trace-log.ts", () => ({
  readCellTraceLogTail: vi.fn(),
}));

import { readCellTraceLogTail } from "../lib/cell-trace-log.ts";

function line(text: string): ServiceLogLine {
  return { text, time: "t" };
}

describe("pickCellTraceLines", () => {
  it("keeps the current reference when lines are equal", () => {
    const current = [line("trace")];
    const next = [line("trace")];
    expect(pickCellTraceLines(current, next)).toBe(current);
  });

  it("returns the next lines when content changed", () => {
    const current = [line("old")];
    const next = [line("new")];
    expect(pickCellTraceLines(current, next)).toBe(next);
  });
});

describe("useCellTraceLog", () => {
  let mounted: MountedHook<ServiceLogLine[]> | undefined;

  beforeEach(() => {
    vi.mocked(readCellTraceLogTail).mockReset();
    vi.mocked(readCellTraceLogTail).mockReturnValue([]);
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
    vi.useRealTimers();
  });

  it("reads immediately and polls every second", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    const first = [line("one")];
    const second = [line("two")];
    vi.mocked(readCellTraceLogTail).mockReturnValue(first);
    mounted = mountHook(() => useCellTraceLog());
    await mounted.flush();
    expect(mounted.get()).toEqual(first);

    vi.mocked(readCellTraceLogTail).mockReturnValue(second);
    await vi.advanceTimersByTimeAsync(1000);
    await mounted.flush();
    expect(mounted.get()).toEqual(second);

    const held = mounted.get();
    await vi.advanceTimersByTimeAsync(1000);
    await mounted.flush();
    expect(mounted.get()).toBe(held);
  });

  it("re-reads when the byte floor identity changes", async () => {
    const floor = { current: { stdout: 0 } as { stdout: number } | undefined };
    vi.mocked(readCellTraceLogTail).mockReturnValue([line("a")]);
    mounted = mountHook(() => useCellTraceLog(floor.current));
    await mounted.flush();
    vi.mocked(readCellTraceLogTail).mockReturnValue([line("b")]);
    floor.current = { stdout: 8 };
    mounted.rerender();
    await mounted.flush();
    expect(mounted.get()).toEqual([line("b")]);
  });
});

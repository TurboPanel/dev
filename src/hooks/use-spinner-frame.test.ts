import { afterEach, describe, expect, it, vi } from "vitest";
import { mountHook, type MountedHook } from "./ink-hook-render.ts";
import { isSpinnerIntervalEnabled, useSpinnerFrame } from "./use-spinner-frame.ts";

describe("isSpinnerIntervalEnabled", () => {
  it("enables positive intervals", () => {
    expect(isSpinnerIntervalEnabled(120)).toBe(true);
    expect(isSpinnerIntervalEnabled(1)).toBe(true);
  });

  it("disables zero and negative intervals", () => {
    expect(isSpinnerIntervalEnabled(0)).toBe(false);
    expect(isSpinnerIntervalEnabled(-1)).toBe(false);
  });
});

describe("useSpinnerFrame", () => {
  let mounted: MountedHook<number> | undefined;

  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
    vi.useRealTimers();
  });

  it("ticks while the interval is enabled and stops when disabled", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    const interval = { ms: 10 };
    mounted = mountHook(() => useSpinnerFrame(interval.ms));
    await mounted.flush();
    expect(mounted.get()).toBe(0);

    await vi.advanceTimersByTimeAsync(10);
    await mounted.flush();
    expect(mounted.get()).toBe(1);

    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    interval.ms = 0;
    mounted.rerender();
    await mounted.flush();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("does not schedule an interval when created disabled", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    mounted = mountHook(() => useSpinnerFrame(0));
    await mounted.flush();
    expect(mounted.get()).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    await mounted.flush();
    expect(mounted.get()).toBe(0);
  });
});

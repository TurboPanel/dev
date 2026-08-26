import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountHook, type MountedHook } from "./ink-hook-render.ts";
import {
  resolveInstanceRuntimeRefresh,
  useInstanceRuntime,
} from "./use-instance-runtime.ts";

vi.mock("../lib/daemon-env.ts", () => ({
  readInstanceRuntime: vi.fn(),
}));

import { readInstanceRuntime } from "../lib/daemon-env.ts";

describe("resolveInstanceRuntimeRefresh", () => {
  it("returns the current runtime when unchanged", () => {
    const current = "deno" as const;
    expect(resolveInstanceRuntimeRefresh(current, "deno")).toBe(current);
  });

  it("returns the next runtime when it changed", () => {
    expect(resolveInstanceRuntimeRefresh("deno", "workers")).toBe("workers");
    expect(resolveInstanceRuntimeRefresh("workers", "deno")).toBe("deno");
  });
});

describe("useInstanceRuntime", () => {
  let mounted: MountedHook<"deno" | "workers"> | undefined;

  beforeEach(() => {
    vi.mocked(readInstanceRuntime).mockReset();
    vi.mocked(readInstanceRuntime).mockReturnValue("deno");
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
    vi.useRealTimers();
  });

  it("polls every two seconds and keeps the current value when unchanged", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    mounted = mountHook(() => useInstanceRuntime());
    await mounted.flush();
    expect(mounted.get()).toBe("deno");

    const held = mounted.get();
    await vi.advanceTimersByTimeAsync(2000);
    await mounted.flush();
    expect(mounted.get()).toBe(held);

    vi.mocked(readInstanceRuntime).mockReturnValue("workers");
    await vi.advanceTimersByTimeAsync(2000);
    await mounted.flush();
    expect(mounted.get()).toBe("workers");
  });
});

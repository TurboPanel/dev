import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DevService } from "../dev-services.ts";
import { mountHook, type MountedHook } from "./ink-hook-render.ts";
import { servicesEqual, useVisibleServices } from "./use-visible-services.ts";

vi.mock("../dev-services.ts", () => ({
  getVisibleServices: vi.fn(),
}));

import { getVisibleServices } from "../dev-services.ts";

function service(
  partial: Partial<DevService> & Pick<DevService, "id">,
): DevService {
  return {
    label: partial.id,
    status: "running",
    ...partial,
  };
}

describe("servicesEqual", () => {
  it("returns true for identical ordered lists", () => {
    const list = [
      service({ id: "daemon", label: "daemon", status: "running" }),
      service({ id: "instance", label: "instance", status: "stopped" }),
    ];
    expect(servicesEqual(list, [...list])).toBe(true);
  });

  it("returns false when lengths differ", () => {
    const left = [service({ id: "daemon" })];
    const right = [service({ id: "daemon" }), service({ id: "instance" })];
    expect(servicesEqual(left, right)).toBe(false);
  });

  it("returns false when id, label, or status differs", () => {
    const base = [service({ id: "daemon", label: "daemon", status: "running" })];
    expect(servicesEqual(base, [service({ id: "instance" })])).toBe(false);
    expect(
      servicesEqual(base, [service({ id: "daemon", label: "other" })]),
    ).toBe(false);
    expect(
      servicesEqual(base, [service({ id: "daemon", status: "stopped" })]),
    ).toBe(false);
  });
});

describe("useVisibleServices", () => {
  const daemon = service({ id: "daemon", label: "daemon", status: "running" });
  const instance = service({
    id: "instance",
    label: "instance",
    status: "stopped",
  });

  let mounted: MountedHook<{
    services: DevService[];
    refresh: () => void;
  }> | undefined;

  beforeEach(() => {
    vi.mocked(getVisibleServices).mockReset();
    vi.mocked(getVisibleServices).mockReturnValue([daemon]);
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
    vi.useRealTimers();
  });

  it("loads the initial snapshot and refreshes on the poll interval", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    mounted = mountHook(() => useVisibleServices());
    await mounted.flush();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await mounted.flush();
    expect(mounted.get().services).toEqual([daemon]);

    vi.mocked(getVisibleServices).mockReturnValue([daemon, instance]);
    await vi.advanceTimersByTimeAsync(15_000);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await mounted.flush();
    expect(mounted.get().services).toEqual([daemon, instance]);
  });

  it("keeps the current list when the snapshot is unchanged", async () => {
    mounted = mountHook(() => useVisibleServices());
    await mounted.flush();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await mounted.flush();
    const first = mounted.get().services;
    vi.mocked(getVisibleServices).mockReturnValue([
      service({ id: "daemon", label: "daemon", status: "running" }),
    ]);
    mounted.get().refresh();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await mounted.flush();
    expect(mounted.get().services).toBe(first);
  });

  it("ignores overlapping refresh while a snapshot is in flight", async () => {
    mounted = mountHook(() => useVisibleServices());
    await mounted.flush();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await mounted.flush();
    let calls = 0;
    vi.mocked(getVisibleServices).mockImplementation(() => {
      calls += 1;
      mounted?.get().refresh();
      return [instance];
    });
    mounted.get().refresh();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await mounted.flush();
    expect(calls).toBe(1);
    expect(mounted.get().services).toEqual([instance]);
  });
});

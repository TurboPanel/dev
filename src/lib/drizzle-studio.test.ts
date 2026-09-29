import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./spawn-trusted.ts", () => ({
  spawnSyncTrustedText: vi.fn(),
}));

import { drizzleStudioBrowserUrl, ensureDrizzleStudioReady } from "./drizzle-studio.ts";
import { spawnSyncTrustedText } from "./spawn-trusted.ts";

const mockedSpawn = vi.mocked(spawnSyncTrustedText);

function curlResult(httpCode: string) {
  return {
    status: 0,
    stdout: httpCode,
    stderr: "",
    pid: 0,
    output: ["", httpCode, ""],
    signal: null,
  };
}

/** Listening flips to true on the `n`th probe (1-based); `Infinity` never flips. */
function listeningOnProbe(n: number): void {
  let probes = 0;
  mockedSpawn.mockImplementation(() => {
    probes += 1;
    return curlResult(probes >= n ? "200" : "000");
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mockedSpawn.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ensureDrizzleStudioReady", () => {
  it("returns without starting the unit when Studio is already listening", async () => {
    listeningOnProbe(1);
    const startUnit = vi.fn(async () => {});
    await expect(ensureDrizzleStudioReady(startUnit)).resolves.toEqual({
      ok: true,
      url: drizzleStudioBrowserUrl(),
    });
    expect(startUnit).not.toHaveBeenCalled();
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it("starts the unit, then probes every 200 ms until it listens", async () => {
    // Probe 1: pre-start check. Probes 2-3: not yet. Probe 4: listening.
    listeningOnProbe(4);
    const startUnit = vi.fn(async () => {});
    const pending = ensureDrizzleStudioReady(startUnit, 5_000);
    await vi.advanceTimersByTimeAsync(400);
    await expect(pending).resolves.toEqual({ ok: true, url: drizzleStudioBrowserUrl() });
    expect(startUnit).toHaveBeenCalledOnce();
    expect(mockedSpawn).toHaveBeenCalledTimes(4);
  });

  it("does not resolve early: nothing is probed before the 200 ms sleep ends", async () => {
    listeningOnProbe(3);
    const pending = ensureDrizzleStudioReady(async () => {}, 5_000);
    await vi.advanceTimersByTimeAsync(199);
    expect(mockedSpawn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(mockedSpawn).toHaveBeenCalledTimes(3);
  });

  it("gives up with the port in the error once the deadline passes", async () => {
    listeningOnProbe(Number.POSITIVE_INFINITY);
    const pending = ensureDrizzleStudioReady(async () => {}, 500);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toEqual({
      ok: false,
      error: "Drizzle Studio did not become ready on port 4983",
    });
    // One pre-start probe, then probes at 0, 200 and 400 ms; 600 ms is past the deadline.
    expect(mockedSpawn).toHaveBeenCalledTimes(4);
  });

  it("does not probe again when the timeout is already spent", async () => {
    listeningOnProbe(Number.POSITIVE_INFINITY);
    const result = await ensureDrizzleStudioReady(async () => {}, 0);
    expect(result.ok).toBe(false);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it("propagates a failed start and never polls", async () => {
    listeningOnProbe(Number.POSITIVE_INFINITY);
    await expect(
      ensureDrizzleStudioReady(async () => {
        throw new Error("unit failed");
      }),
    ).rejects.toThrow("unit failed");
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });
});

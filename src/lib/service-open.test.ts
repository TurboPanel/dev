import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./open-url.ts", () => ({
  isHttpListening: vi.fn(),
  openUrlInBrowser: vi.fn(),
}));

vi.mock("./drizzle-studio.ts", () => ({
  ensureDrizzleStudioReady: vi.fn(),
}));

vi.mock("./service-urls.ts", () => ({
  serviceBrowserUrl: vi.fn(),
}));

import { ensureDrizzleStudioReady } from "./drizzle-studio.ts";
import { isHttpListening, openUrlInBrowser } from "./open-url.ts";
import { ensureServiceReadyForOpen, openServiceInBrowser } from "./service-open.ts";
import { serviceBrowserUrl } from "./service-urls.ts";

const mockedListening = vi.mocked(isHttpListening);
const mockedOpen = vi.mocked(openUrlInBrowser);
const mockedDrizzle = vi.mocked(ensureDrizzleStudioReady);
const mockedUrl = vi.mocked(serviceBrowserUrl);

const URL_UI = "https://localhost:8443/";

/** Probes report listening from the `n`th call on (1-based); `Infinity` never. */
function listeningFromProbe(n: number): void {
  let probes = 0;
  mockedListening.mockImplementation(() => {
    probes += 1;
    return probes >= n;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mockedListening.mockReset();
  mockedOpen.mockReset();
  mockedDrizzle.mockReset();
  mockedUrl.mockReset();
  mockedUrl.mockReturnValue(URL_UI);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ensureServiceReadyForOpen", () => {
  it("returns the URL without starting anything when it already answers", async () => {
    listeningFromProbe(1);
    const startUnit = vi.fn(async () => {});
    await expect(ensureServiceReadyForOpen("website", startUnit)).resolves.toBe(URL_UI);
    expect(startUnit).not.toHaveBeenCalled();
    expect(mockedListening).toHaveBeenCalledWith(URL_UI, 1);
  });

  it("probes caddy and instance with a 2 second budget", async () => {
    listeningFromProbe(1);
    await ensureServiceReadyForOpen("caddy", async () => {});
    expect(mockedListening).toHaveBeenCalledWith(URL_UI, 2);
  });

  it("starts the unit, then probes every 200 ms until it answers", async () => {
    // Probe 1: pre-start. Probes 2-3: not yet. Probe 4: answering.
    listeningFromProbe(4);
    const startUnit = vi.fn(async () => {});
    const pending = ensureServiceReadyForOpen("website", startUnit);
    await vi.advanceTimersByTimeAsync(400);
    await expect(pending).resolves.toBe(URL_UI);
    expect(startUnit).toHaveBeenCalledOnce();
    expect(mockedListening).toHaveBeenCalledTimes(4);
  });

  it("waits the full 200 ms before each further probe", async () => {
    listeningFromProbe(3);
    const pending = ensureServiceReadyForOpen("website", async () => {});
    await vi.advanceTimersByTimeAsync(199);
    expect(mockedListening).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(URL_UI);
    expect(mockedListening).toHaveBeenCalledTimes(3);
  });

  it("throws once the 30 s deadline passes without an answer", async () => {
    listeningFromProbe(Number.POSITIVE_INFINITY);
    const pending = ensureServiceReadyForOpen("website", async () => {});
    const settled = expect(pending).rejects.toThrow(
      `website did not become ready at ${URL_UI}`,
    );
    await vi.advanceTimersByTimeAsync(31_000);
    await settled;
    // One pre-start probe, then one probe per 200 ms from 0 to 29 800 ms.
    expect(mockedListening).toHaveBeenCalledTimes(151);
  });

  it("propagates a failed start and never polls", async () => {
    listeningFromProbe(Number.POSITIVE_INFINITY);
    await expect(
      ensureServiceReadyForOpen("website", async () => {
        throw new Error("unit failed");
      }),
    ).rejects.toThrow("unit failed");
    expect(mockedListening).toHaveBeenCalledTimes(1);
  });

  it("skips readiness when the service has no browser URL and then reports it", async () => {
    mockedUrl.mockReturnValue(null);
    await expect(ensureServiceReadyForOpen("mystery", async () => {})).rejects.toThrow(
      "No browser URL for mystery",
    );
    expect(mockedListening).not.toHaveBeenCalled();
  });

  it("delegates dbstudio to the Drizzle Studio readiness check", async () => {
    mockedDrizzle.mockResolvedValue({ ok: true, url: "https://studio" });
    await expect(ensureServiceReadyForOpen("dbstudio", async () => {})).resolves.toBe(
      "https://studio",
    );
    mockedDrizzle.mockResolvedValue({ ok: false, error: "no studio" });
    await expect(ensureServiceReadyForOpen("dbstudio", async () => {})).rejects.toThrow(
      "no studio",
    );
  });
});

describe("openServiceInBrowser", () => {
  it("opens the URL, or tells the user to when no opener works", async () => {
    listeningFromProbe(1);
    mockedOpen.mockReturnValueOnce(true).mockReturnValueOnce(false);
    const lines: string[] = [];
    await openServiceInBrowser("website", async () => {}, (line) => lines.push(line));
    expect(lines).toEqual([]);
    await openServiceInBrowser("website", async () => {}, (line) => lines.push(line));
    expect(lines).toEqual([`Open ${URL_UI} in your browser`]);
  });
});

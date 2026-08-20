import { spawnSyncTrustedText } from "./spawn-trusted.ts";

export const DRIZZLE_STUDIO_PORT = 4983;
export const DRIZZLE_STUDIO_BROWSER_URL =
  `https://local.drizzle.studio?host=localhost&port=${DRIZZLE_STUDIO_PORT}`;

export { openUrlInBrowser } from "./open-url.ts";

export function drizzleStudioBrowserUrl(
  port = DRIZZLE_STUDIO_PORT,
  host = "localhost",
): string {
  const params = new URLSearchParams({ host, port: String(port) });
  return `https://local.drizzle.studio?${params.toString()}`;
}

export function isDrizzleStudioListening(): boolean {
  const result = spawnSyncTrustedText(
    "curl",
    [
      "-s",
      "--max-time",
      "1",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      `http://127.0.0.1:${DRIZZLE_STUDIO_PORT}/`,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  const code = Number((result.stdout ?? "").trim());
  return Number.isFinite(code) && code > 0 && code < 500;
}

export async function ensureDrizzleStudioReady(
  startUnit: () => Promise<void>,
  timeoutMs = 30_000,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (isDrizzleStudioListening()) {
    return { ok: true, url: drizzleStudioBrowserUrl() };
  }

  await startUnit();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isDrizzleStudioListening()) {
      return { ok: true, url: drizzleStudioBrowserUrl() };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return {
    ok: false,
    error: `Drizzle Studio did not become ready on port ${DRIZZLE_STUDIO_PORT}`,
  };
}

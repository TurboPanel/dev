import type { InstallOutputHandler } from "./install-output.ts";
import { isHttpListening, openUrlInBrowser } from "./open-url.ts";
import { ensureDrizzleStudioReady } from "./drizzle-studio.ts";
import { serviceBrowserUrl } from "./service-urls.ts";

type StartUnit = () => Promise<void>;

async function waitForListening(
  url: string,
  timeoutMs = 30_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isHttpListening(url)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function ensureHttpServiceReady(
  serviceId: string,
  startUnit: StartUnit,
  timeoutMs = 30_000,
): Promise<void> {
  const url = serviceBrowserUrl(serviceId);
  if (!url || isHttpListening(url, serviceId === "instance" || serviceId === "web" ? 2 : 1)) {
    return;
  }
  await startUnit();
  if (!(await waitForListening(url, timeoutMs))) {
    throw new Error(`${serviceId} did not become ready at ${url}`);
  }
}

export async function ensureServiceReadyForOpen(
  serviceId: string,
  startUnit: StartUnit,
): Promise<string> {
  if (serviceId === "dbstudio") {
    const ready = await ensureDrizzleStudioReady(startUnit);
    if (!ready.ok) {
      throw new Error(ready.error);
    }
    return ready.url;
  }

  await ensureHttpServiceReady(serviceId, startUnit);

  const url = serviceBrowserUrl(serviceId);
  if (!url) {
    throw new Error(`No browser URL for ${serviceId}`);
  }
  return url;
}

export async function openServiceInBrowser(
  serviceId: string,
  startUnit: StartUnit,
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const url = await ensureServiceReadyForOpen(serviceId, startUnit);
  if (!openUrlInBrowser(url)) {
    onOutput?.(`Open ${url} in your browser`);
  }
}

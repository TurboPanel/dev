import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DRIZZLE_STUDIO_PORT, drizzleStudioBrowserUrl } from "./drizzle-studio.ts";

vi.mock("./env-file.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./env-file.ts")>();
  return {
    ...actual,
    readEnvFile: vi.fn(() => ""),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

async function loadServiceUrls(daemonEnvContent = "") {
  const { readEnvFile } = await import("./env-file.ts");
  vi.mocked(readEnvFile).mockReturnValue(daemonEnvContent);
  return import("./service-urls.ts");
}

beforeEach(() => {
  vi.resetModules();
});

test("process.env port override wins over daemon.env", async () => {
  vi.stubEnv("CADDY_PORT", "9443");
  const urls = await loadServiceUrls("CADDY_PORT=8444\n");
  expect(urls.caddyBrowserUrl()).toBe("https://localhost:9443");
});

test("daemon.env value is used when process env is absent", async () => {
  vi.stubEnv("CADDY_PORT", "");
  const urls = await loadServiceUrls("CADDY_PORT=9001\n");
  expect(urls.caddyBrowserUrl()).toBe("https://localhost:9001");
});

test("documented defaults apply when both sources are absent", async () => {
  const urls = await loadServiceUrls("");
  expect(urls.caddyBrowserUrl()).toBe(
    `https://localhost:${urls.DEFAULT_CADDY_PORT}`,
  );
  expect(urls.websiteBrowserUrl()).toBe(
    `http://localhost:${urls.DEFAULT_WEBSITE_PORT}`,
  );
  expect(urls.mailpitBrowserUrl()).toBe(
    `http://localhost:${urls.DEFAULT_MAILPIT_WEB_PORT}`,
  );
  expect(urls.rabbitmqMgmtBrowserUrl()).toBe(
    `http://127.0.0.1:${urls.DEFAULT_RABBITMQ_MGMT_PORT}`,
  );
  expect(urls.redisInsightBrowserUrl()).toBe(
    `http://127.0.0.1:${urls.DEFAULT_REDIS_INSIGHT_WEB_PORT}`,
  );
  expect(urls.tabixBrowserUrl()).toBe(
    `http://127.0.0.1:${urls.DEFAULT_TABIX_WEB_PORT}`,
  );
});

test("invalid, zero, and non-numeric ports fall back to the default", async () => {
  vi.stubEnv("CADDY_PORT", "0");
  vi.stubEnv("WEBSITE_PORT", "nope");
  vi.stubEnv("MAILPIT_WEB_PORT", "-1");
  const urls = await loadServiceUrls(
    "CADDY_PORT=0\nWEBSITE_PORT=abc\nMAILPIT_WEB_PORT=-5\n",
  );
  expect(urls.caddyBrowserUrl()).toBe(
    `https://localhost:${urls.DEFAULT_CADDY_PORT}`,
  );
  expect(urls.websiteBrowserUrl()).toBe(
    `http://localhost:${urls.DEFAULT_WEBSITE_PORT}`,
  );
  expect(urls.mailpitBrowserUrl()).toBe(
    `http://localhost:${urls.DEFAULT_MAILPIT_WEB_PORT}`,
  );
});

test("browser URL host conventions match the documented scheme/host pairs", async () => {
  const urls = await loadServiceUrls("");
  expect(urls.caddyBrowserUrl().startsWith("https://localhost:")).toBe(true);
  expect(urls.websiteBrowserUrl().startsWith("http://localhost:")).toBe(true);
  expect(urls.rabbitmqMgmtBrowserUrl().startsWith("http://127.0.0.1:")).toBe(
    true,
  );
  expect(urls.redisInsightBrowserUrl().startsWith("http://127.0.0.1:")).toBe(
    true,
  );
  expect(urls.tabixBrowserUrl().startsWith("http://127.0.0.1:")).toBe(true);
});

test("serviceBrowserUrl maps every known service and returns null for unknown", async () => {
  const urls = await loadServiceUrls("");
  const caddy = urls.caddyBrowserUrl();
  expect(urls.serviceBrowserUrl("instance")).toBe(caddy);
  expect(urls.serviceBrowserUrl("caddy")).toBe(caddy);
  expect(urls.serviceBrowserUrl("ui")).toBe(caddy);
  expect(urls.serviceBrowserUrl("website")).toBe(urls.websiteBrowserUrl());
  expect(urls.serviceBrowserUrl("dbstudio")).toBe(
    drizzleStudioBrowserUrl(DRIZZLE_STUDIO_PORT),
  );
  expect(urls.serviceBrowserUrl("smtp")).toBe(urls.mailpitBrowserUrl());
  expect(urls.serviceBrowserUrl("queue")).toBe(urls.rabbitmqMgmtBrowserUrl());
  expect(urls.serviceBrowserUrl("redisinsight")).toBe(
    urls.redisInsightBrowserUrl(),
  );
  expect(urls.serviceBrowserUrl("tabix")).toBe(urls.tabixBrowserUrl());
  expect(urls.serviceBrowserUrl("nope")).toBeNull();
});

test("serviceSupportsOpen agrees with serviceBrowserUrl", async () => {
  const urls = await loadServiceUrls("");
  for (const id of [
    "instance",
    "caddy",
    "ui",
    "website",
    "dbstudio",
    "smtp",
    "queue",
    "redisinsight",
    "tabix",
  ]) {
    expect(urls.serviceSupportsOpen(id)).toBe(true);
    expect(urls.serviceBrowserUrl(id)).not.toBeNull();
  }
  expect(urls.serviceSupportsOpen("unknown")).toBe(false);
  expect(urls.serviceBrowserUrl("unknown")).toBeNull();
});

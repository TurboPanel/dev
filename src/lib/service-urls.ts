import { DAEMON_ENV_PATH } from "./paths.ts";
import {
  DRIZZLE_STUDIO_PORT,
  drizzleStudioBrowserUrl,
} from "./drizzle-studio.ts";
import { parseEnvEntries, readEnvFile } from "./env-file.ts";

export const DEFAULT_CADDY_PORT = 8443;
export const DEFAULT_WEBSITE_PORT = 19820;
export const DEFAULT_MAILPIT_WEB_PORT = 8025;
export const DEFAULT_RABBITMQ_MGMT_PORT = 15672;
export const DEFAULT_REDIS_INSIGHT_WEB_PORT = 5540;
export const DEFAULT_DUCKDB_UI_PORT = 4213;

const PORT_ENV_KEYS: Record<string, string> = {
  CADDY_PORT: "CADDY_PORT",
  WEBSITE_PORT: "WEBSITE_PORT",
  MAILPIT_WEB_PORT: "MAILPIT_WEB_PORT",
  RABBITMQ_MGMT_PORT: "RABBITMQ_MGMT_PORT",
  REDIS_INSIGHT_WEB_PORT: "REDIS_INSIGHT_WEB_PORT",
  DUCKDB_UI_PORT: "DUCKDB_UI_PORT",
};

let cachedEnvEntries: Map<string, string> | null = null;

function envEntries(): Map<string, string> {
  cachedEnvEntries ??= parseEnvEntries(readEnvFile(DAEMON_ENV_PATH));
  return cachedEnvEntries;
}

function resolvePort(envKey: string, defaultPort: number): number {
  const fromProcess = process.env[envKey]?.trim();
  if (fromProcess) {
    const parsed = Number.parseInt(fromProcess, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const fromDaemonEnv = envEntries().get(envKey)?.trim();
  if (fromDaemonEnv) {
    const parsed = Number.parseInt(fromDaemonEnv, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return defaultPort;
}

export function caddyBrowserUrl(): string {
  const port = resolvePort(PORT_ENV_KEYS.CADDY_PORT!, DEFAULT_CADDY_PORT);
  return `https://localhost:${port}`;
}

export function websiteBrowserUrl(): string {
  const port = resolvePort(PORT_ENV_KEYS.WEBSITE_PORT!, DEFAULT_WEBSITE_PORT);
  return `http://localhost:${port}`;
}

export function mailpitBrowserUrl(): string {
  const port = resolvePort(PORT_ENV_KEYS.MAILPIT_WEB_PORT!, DEFAULT_MAILPIT_WEB_PORT);
  return `http://localhost:${port}`;
}

export function rabbitmqMgmtBrowserUrl(): string {
  const port = resolvePort(
    PORT_ENV_KEYS.RABBITMQ_MGMT_PORT!,
    DEFAULT_RABBITMQ_MGMT_PORT,
  );
  return `http://127.0.0.1:${port}`;
}

export function redisInsightBrowserUrl(): string {
  const port = resolvePort(
    PORT_ENV_KEYS.REDIS_INSIGHT_WEB_PORT!,
    DEFAULT_REDIS_INSIGHT_WEB_PORT,
  );
  return `http://127.0.0.1:${port}`;
}

/** Embedded DuckDB UI served by the instance's own DuckDB (on-demand). */
export function duckdbUiBrowserUrl(): string {
  const port = resolvePort(PORT_ENV_KEYS.DUCKDB_UI_PORT!, DEFAULT_DUCKDB_UI_PORT);
  return `http://127.0.0.1:${port}`;
}

export function serviceBrowserUrl(serviceId: string): string | null {
  switch (serviceId) {
    case "instance":
    case "caddy":
    case "ui":
      return caddyBrowserUrl();
    case "website":
      return websiteBrowserUrl();
    case "dbstudio":
      return drizzleStudioBrowserUrl(DRIZZLE_STUDIO_PORT);
    case "smtp":
      return mailpitBrowserUrl();
    case "queue":
      return rabbitmqMgmtBrowserUrl();
    case "redisinsight":
      return redisInsightBrowserUrl();
    default:
      return null;
  }
}

export function serviceSupportsOpen(serviceId: string): boolean {
  return serviceBrowserUrl(serviceId) !== null;
}

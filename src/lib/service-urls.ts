import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { DAEMON_ENV_PATH } from "./paths.ts";
import {
  DRIZZLE_STUDIO_PORT,
  drizzleStudioBrowserUrl,
} from "./drizzle-studio.ts";

export const DEFAULT_CADDY_PORT = 8443;
export const DEFAULT_WEBSITE_PORT = 19820;
export const DEFAULT_MAILPIT_WEB_PORT = 19826;
export const DEFAULT_RABBITMQ_MGMT_PORT = 15672;

const PORT_ENV_KEYS: Record<string, string> = {
  CADDY_PORT: "CADDY_PORT",
  WEBSITE_PORT: "WEBSITE_PORT",
  MAILPIT_WEB_PORT: "MAILPIT_WEB_PORT",
  RABBITMQ_MGMT_PORT: "RABBITMQ_MGMT_PORT",
};

function readEnvFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    const result = spawnSync("sudo", ["-n", "cat", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return result.status === 0 ? (result.stdout ?? "") : "";
  }
}

function parseEnvEntries(content: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of content.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      entries.set(match[1]!, match[2]!);
    }
  }
  return entries;
}

let cachedEnvEntries: Map<string, string> | null = null;

function envEntries(): Map<string, string> {
  if (!cachedEnvEntries) {
    cachedEnvEntries = parseEnvEntries(readEnvFile(DAEMON_ENV_PATH));
  }
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

export function serviceBrowserUrl(serviceId: string): string | null {
  switch (serviceId) {
    case "instance":
    case "ui":
      return caddyBrowserUrl();
    case "website":
      return websiteBrowserUrl();
    case "dbstudio":
      return drizzleStudioBrowserUrl(DRIZZLE_STUDIO_PORT);
    case "mailpit":
      return mailpitBrowserUrl();
    case "queue":
      return rabbitmqMgmtBrowserUrl();
    default:
      return null;
  }
}

export function serviceSupportsOpen(serviceId: string): boolean {
  return serviceBrowserUrl(serviceId) !== null;
}

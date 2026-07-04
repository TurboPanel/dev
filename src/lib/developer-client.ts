import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { platformCaCertPath } from "./paths.ts";
import { caddyBrowserUrl } from "./service-urls.ts";
import { readInstanceRuntime } from "./daemon-env.ts";

/**
 * Live developer-surface client for the co-located instance.
 *
 * Talks to the Deno instance over its Unix domain socket
 * (`/run/turbopanel/instance.sock`, the default co-located dev transport) and
 * falls back to the Caddy HTTPS entrypoint when the socket is unavailable or the
 * instance runs in Workers mode. The dev console uses this to drive the live
 * `/api/developer/v1/daemon/sync-dev` source-sync flow instead of building
 * binaries locally.
 */
export const DEVELOPER_API = "/api/developer/v1";

const INSTANCE_SOCKET = "/run/turbopanel/instance.sock";
/** Generous: the instance waits up to ~180s for each daemon's dev-sync ack. */
const REQUEST_TIMEOUT_MS = 240_000;

export type DaemonSyncResult = {
  daemonId: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

export type SyncDevResponse = {
  ok: boolean;
  results?: DaemonSyncResult[];
  daemonId?: string;
  error?: string;
};

interface RawResponse {
  status: number;
  body: string;
}

function collectBody(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    res.on("error", reject);
  });
}

function jsonHeaders(bodyText: string): Record<string, string | number> {
  return {
    host: "localhost",
    accept: "application/json",
    "content-type": "application/json",
    "content-length": Buffer.byteLength(bodyText),
  };
}

function requestViaSocket(
  path: string,
  method: string,
  bodyText: string,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        socketPath: INSTANCE_SOCKET,
        path,
        method,
        headers: jsonHeaders(bodyText),
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        collectBody(res)
          .then((body) => resolve({ status: res.statusCode ?? 500, body }))
          .catch(reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("instance socket timed out")));
    req.on("error", reject);
    if (bodyText) req.write(bodyText);
    req.end();
  });
}

let cachedCaCert: Buffer | null | undefined;

function loadCaCert(): Buffer | undefined {
  if (cachedCaCert === undefined) {
    try {
      cachedCaCert = readFileSync(platformCaCertPath());
    } catch {
      cachedCaCert = null;
    }
  }
  return cachedCaCert ?? undefined;
}

function requestViaHttps(
  path: string,
  method: string,
  bodyText: string,
): Promise<RawResponse> {
  const base = new URL(caddyBrowserUrl());
  const ca = loadCaCert();
  const options: RequestOptions = {
    hostname: base.hostname,
    port: base.port,
    path,
    method,
    headers: jsonHeaders(bodyText),
    timeout: REQUEST_TIMEOUT_MS,
    ...(ca ? { ca } : { rejectUnauthorized: false }),
  };
  return new Promise((resolve, reject) => {
    const req = httpsRequest(options, (res) => {
      collectBody(res)
        .then((body) => resolve({ status: res.statusCode ?? 500, body }))
        .catch(reject);
    });
    req.on("timeout", () => req.destroy(new Error("instance HTTPS timed out")));
    req.on("error", reject);
    if (bodyText) req.write(bodyText);
    req.end();
  });
}

async function developerFetch<T>(
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" },
): Promise<T> {
  const bodyText = init.body === undefined ? "" : JSON.stringify(init.body);

  let raw: RawResponse;
  if (readInstanceRuntime() === "workers") {
    raw = await requestViaHttps(path, init.method, bodyText);
  } else {
    try {
      raw = await requestViaSocket(path, init.method, bodyText);
    } catch {
      raw = await requestViaHttps(path, init.method, bodyText);
    }
  }

  if (raw.status < 200 || raw.status >= 300) {
    let detail = `HTTP ${raw.status}`;
    try {
      const parsed = JSON.parse(raw.body) as { error?: string };
      if (parsed.error) detail = parsed.error;
    } catch {
      // Non-JSON error body — keep the status-only detail.
    }
    throw new Error(`${path} failed: ${detail}`);
  }

  return JSON.parse(raw.body) as T;
}

/** Sync the local daemon source build to every attached daemon. */
export async function syncDevToAllDaemons(): Promise<SyncDevResponse> {
  return await developerFetch(`${DEVELOPER_API}/daemon/sync-dev`, {
    method: "POST",
  });
}

/** Sync the local daemon source build to a single attached daemon. */
export async function syncDevToDaemon(daemonId: string): Promise<SyncDevResponse> {
  return await developerFetch(
    `${DEVELOPER_API}/daemon/${encodeURIComponent(daemonId)}/sync-dev`,
    { method: "POST" },
  );
}

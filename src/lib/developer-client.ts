import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { readInstanceRuntime } from "./daemon-env.ts";
import { CONFIG_DIR } from "./paths.ts";

/**
 * Live developer-surface client for the co-located instance.
 *
 * Deno runtime: talks over the Unix domain socket with HMAC local-console auth
 * (`/run/turbopanel/instance.sock`). Workers runtime: dev-sync is unavailable
 * (route is Deno-only).
 */
export const DEVELOPER_API = "/api/developer/v1";

const INSTANCE_SOCKET = "/run/turbopanel/instance.sock";
const INSTANCE_SECRET_PATH = `${CONFIG_DIR}/instance/.instance_secret`;
const LOCAL_CONSOLE_SCHEME = "Local-Console";
const LOCAL_CONSOLE_INFO = "local-console-v1";
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

function readInstanceSecret(): string | undefined {
  try {
    const secret = readFileSync(INSTANCE_SECRET_PATH, "utf8").trim();
    return secret || undefined;
  } catch {
    return undefined;
  }
}

function buildLocalConsoleAuthorization(
  method: string,
  path: string,
  secret: string,
): string {
  const timestamp = new Date().toISOString();
  const payload = `${LOCAL_CONSOLE_INFO}\0${timestamp}\0${method.toUpperCase()}\0${path}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  const timestampPart = Buffer.from(timestamp, "utf8").toString("base64url");
  return `${LOCAL_CONSOLE_SCHEME} ${timestampPart}.${signature}`;
}

function jsonHeaders(
  path: string,
  method: string,
  bodyText: string,
): Record<string, string | number> {
  const headers: Record<string, string | number> = {
    host: "localhost",
    accept: "application/json",
    "content-type": "application/json",
    "content-length": Buffer.byteLength(bodyText),
  };
  const secret = readInstanceSecret();
  if (secret) {
    headers.authorization = buildLocalConsoleAuthorization(method, path, secret);
  }
  return headers;
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
        headers: jsonHeaders(path, method, bodyText),
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

async function developerFetch<T>(
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" },
): Promise<T> {
  if (readInstanceRuntime() === "workers") {
    throw new Error(
      "dev-sync is unavailable when the instance runtime is Workers — switch to Deno runtime",
    );
  }

  if (!readInstanceSecret()) {
    throw new Error(
      `missing instance secret at ${INSTANCE_SECRET_PATH} — cannot authenticate local developer API calls`,
    );
  }

  const bodyText = init.body === undefined ? "" : JSON.stringify(init.body);

  let raw: RawResponse;
  try {
    raw = await requestViaSocket(path, init.method, bodyText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `instance Unix socket unavailable (${INSTANCE_SOCKET}): ${message}`,
    );
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

/** @internal Exported for unit tests. */
export function buildLocalConsoleAuthHeader(
  method: string,
  path: string,
  secret: string,
): string {
  return buildLocalConsoleAuthorization(method, path, secret);
}

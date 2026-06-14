import { TURBOPANEL_PLATFORM } from "@turbopanel/paths";

export const DEVELOPER_API = "/api/developer/v1";
export const CLIENT_API = "/api/client/v1";

const INSTANCE_SOCKET = "/run/turbopanel/instance.sock";
const HTTPS_FALLBACK = "https://localhost:8443";
const CA_CERT_PATH = `${TURBOPANEL_PLATFORM}/turbopanel/certs/ca.crt`;

let httpsClient: Deno.HttpClient | undefined;

function getHttpsClient(): Deno.HttpClient {
  if (!httpsClient) {
    try {
      const caCert = Deno.readTextFileSync(CA_CERT_PATH);
      httpsClient = Deno.createHttpClient({ caCerts: [caCert] });
    } catch {
      httpsClient = Deno.createHttpClient({ caCerts: [] });
    }
  }
  return httpsClient;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function fetchViaUnixSocket(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const method = init?.method ?? "GET";
  let bodyText = "";
  if (init?.body) {
    bodyText = typeof init.body === "string"
      ? init.body
      : await new Response(init.body).text();
  }

  const headerLines = [
    `${method} ${path} HTTP/1.1`,
    "Host: localhost",
    "Connection: close",
    "Accept: application/json",
  ];
  if (bodyText) {
    const bytes = new TextEncoder().encode(bodyText);
    headerLines.push("Content-Type: application/json");
    headerLines.push(`Content-Length: ${bytes.length}`);
  }
  const request = `${headerLines.join("\r\n")}\r\n\r\n${bodyText}`;

  const conn = await Deno.connect({ transport: "unix", path: INSTANCE_SOCKET });
  try {
    await conn.write(new TextEncoder().encode(request));

    const buf = new Uint8Array(65536);
    const chunks: Uint8Array[] = [];
    while (true) {
      const n = await conn.read(buf);
      if (n === null) break;
      chunks.push(buf.slice(0, n));
    }

    const raw = new TextDecoder().decode(concatBytes(chunks));
    const separator = raw.indexOf("\r\n\r\n");
    if (separator === -1) {
      throw new Error("Invalid HTTP response from instance socket");
    }

    const headerPart = raw.slice(0, separator);
    const body = raw.slice(separator + 4);
    const statusLine = headerPart.split("\r\n")[0] ?? "";
    const statusMatch = statusLine.match(/HTTP\/[\d.]+\s+(\d+)/);
    const status = statusMatch ? Number.parseInt(statusMatch[1], 10) : 500;

    return new Response(body, { status });
  } finally {
    conn.close();
  }
}

async function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = {
    "content-type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };

  try {
    return await fetchViaUnixSocket(path, { ...init, headers });
  } catch {
    return await fetch(`${HTTPS_FALLBACK}${path}`, {
      ...init,
      headers,
      client: getHttpsClient(),
    });
  }
}

export async function instanceFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await rawFetch(path, init);

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json() as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // Non-JSON error body — keep the status-only message.
    }
    throw new Error(`${path} failed: ${detail}`);
  }

  return await response.json() as T;
}

export type DaemonConnection = {
  id: string;
  connectedAt: string;
  hostname: string | null;
  serverId: string | null;
  remoteAddress: string | null;
};

function fleetKey(conn: DaemonConnection): string {
  const address = conn.remoteAddress?.trim();
  return conn.serverId?.trim() ||
    conn.hostname?.trim() ||
    (address && address !== "__direct__" ? address : "") ||
    conn.id;
}

export function uniqueFleetConnections(
  connections: DaemonConnection[],
): DaemonConnection[] {
  const byKey = new Map<string, DaemonConnection>();
  for (const conn of connections) {
    const key = fleetKey(conn);
    const existing = byKey.get(key);
    if (!existing || conn.connectedAt > existing.connectedAt) {
      byKey.set(key, conn);
    }
  }
  return [...byKey.values()].sort((a, b) =>
    a.connectedAt.localeCompare(b.connectedAt)
  );
}

export function daemonLabel(
  daemonId: string,
  connections: DaemonConnection[],
): string {
  const conn = connections.find((entry) => entry.id === daemonId);
  const hostname = conn?.hostname?.trim();
  if (hostname) return hostname;
  const address = conn?.remoteAddress?.trim();
  if (address) return address;
  return daemonId;
}

export type DaemonEvent =
  | { at: string; kind: "connected"; daemonId: string }
  | { at: string; kind: "disconnected"; daemonId: string }
  | {
    at: string;
    kind: "message";
    daemonId: string;
    direction: "in" | "out";
    message: { type: string; [key: string]: unknown };
  }
  | { at: string; kind: "broadcast"; sent: number; payload: unknown };

export type CommandResult = {
  id: string;
  daemonId: string;
  command: string;
  status: "pending" | "done";
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  sentAt: string;
  finishedAt?: string;
};

export type ServerAddresses = {
  privateIpv4: string[];
  privateIpv6: string[];
  publicIpv4: string[];
  publicIpv6: string[];
};

export type ServerAddressEntry = {
  source: string;
  addresses?: ServerAddresses;
  error?: string;
};

export type OrganizationRecord = {
  id: string;
  displayName: string;
  slug: string | null;
};

export type ServerRecord = {
  id: string;
  displayName: string | null;
  organizationId: string | null;
  options: Record<string, unknown> | null;
  createdAt: string;
};

export type DirtyRepo = {
  repo: string;
  path: string;
  changes: number;
};

export type UpgradeStatus = {
  ok: boolean;
  canUpgrade: boolean;
  dirty: DirtyRepo[];
};

export type DatabaseStatus = {
  configured: boolean;
  connected: boolean;
  transport: "socket" | "tcp" | null;
  user: string | null;
  database: string | null;
  version: string | null;
  error: string | null;
};

export type DrizzleStudioStatus = {
  running: boolean;
  browserUrl: string;
  port: number;
};

export const DRIZZLE_STUDIO_PORT = 4983;

export function drizzleStudioOpenUrl(opts?: {
  hostname?: string;
  port?: number;
}): string {
  const base = "https://local.drizzle.studio";
  const hostname = opts?.hostname ?? "localhost";
  const port = opts?.port ?? DRIZZLE_STUDIO_PORT;
  const params = new URLSearchParams({
    host: hostname,
    port: String(port),
  });
  return `${base}?${params.toString()}`;
}

export async function fetchHealth(): Promise<{ ok: boolean }> {
  return await instanceFetch("/api/health");
}

export async function fetchDaemonConnections(): Promise<
  { connections: DaemonConnection[] }
> {
  return await instanceFetch(`${DEVELOPER_API}/daemon/connections`);
}

export async function fetchDaemonEvents(
  limit = 40,
): Promise<{ events: DaemonEvent[] }> {
  return await instanceFetch(`${DEVELOPER_API}/daemon/events?limit=${limit}`);
}

export async function broadcastToDaemon(
  payload: unknown,
): Promise<{ ok: boolean; sent: number }> {
  return await instanceFetch(`${DEVELOPER_API}/daemon/broadcast`, {
    method: "POST",
    body: JSON.stringify({ payload }),
  });
}

export async function fetchCommandResults(
  limit = 25,
): Promise<{ commands: CommandResult[] }> {
  return await instanceFetch(`${DEVELOPER_API}/daemon/commands?limit=${limit}`);
}

export async function runCommand(
  daemonId: string,
  command: string,
): Promise<{ ok: boolean; commandId: string }> {
  return await instanceFetch(
    `${DEVELOPER_API}/daemon/${encodeURIComponent(daemonId)}/command`,
    {
      method: "POST",
      body: JSON.stringify({ command }),
    },
  );
}

export async function runCommandOnAll(
  command: string,
): Promise<{ ok: boolean; sent: number; commandIds: string[] }> {
  return await instanceFetch(`${DEVELOPER_API}/daemon/command`, {
    method: "POST",
    body: JSON.stringify({ command }),
  });
}

export async function fetchInstanceAddresses(): Promise<{
  ok: boolean;
  source: string;
  addresses: ServerAddresses;
}> {
  return await instanceFetch(`${DEVELOPER_API}/instance/addresses`);
}

export async function fetchDaemonAddresses(
  daemonId: string,
): Promise<{
  ok: boolean;
  daemonId: string;
  hostname: string | null;
  addresses: ServerAddresses;
}> {
  return await instanceFetch(
    `${DEVELOPER_API}/daemon/${encodeURIComponent(daemonId)}/addresses`,
  );
}

export async function fetchAllDaemonAddresses(): Promise<{
  servers: Array<{
    daemonId: string;
    hostname: string | null;
    addresses?: ServerAddresses;
    error?: string;
  }>;
}> {
  return await instanceFetch(`${DEVELOPER_API}/daemon/addresses`);
}

export async function fetchOrganizations(): Promise<
  { organizations: OrganizationRecord[] }
> {
  return await instanceFetch(`${DEVELOPER_API}/organizations`);
}

export async function fetchServers(): Promise<{ servers: ServerRecord[] }> {
  return await instanceFetch(`${DEVELOPER_API}/servers`);
}

export async function createServer(body: {
  displayName?: string | null;
  options?: Record<string, unknown> | null;
}): Promise<{ ok: true; id: string }> {
  return await instanceFetch(`${DEVELOPER_API}/servers`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateServer(
  id: string,
  body: {
    displayName?: string | null;
    organizationId?: string | null;
    options?: Record<string, unknown> | null;
  },
): Promise<{ ok: true }> {
  return await instanceFetch(
    `${DEVELOPER_API}/servers/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    },
  );
}

export async function fetchUpgradeStatus(): Promise<UpgradeStatus> {
  return await instanceFetch(`${DEVELOPER_API}/system/upgrade-status`);
}

export async function fetchDatabaseStatus(): Promise<DatabaseStatus> {
  return await instanceFetch(`${DEVELOPER_API}/database/status`);
}

export async function fetchDrizzleStudioStatus(): Promise<DrizzleStudioStatus> {
  return await instanceFetch(`${DEVELOPER_API}/database/studio`);
}

export async function startDrizzleStudio(): Promise<{
  ok: boolean;
  browserUrl: string;
  port: number;
}> {
  return await instanceFetch(`${DEVELOPER_API}/database/studio`, {
    method: "POST",
  });
}

export async function upgradeSystem(): Promise<{ ok: boolean; commit: string }> {
  return await instanceFetch(`${DEVELOPER_API}/system/upgrade`, {
    method: "POST",
  });
}

export async function resetDevInstance(): Promise<
  { ok: true; restarted: boolean }
> {
  return await instanceFetch(`${DEVELOPER_API}/system/reset-dev`, {
    method: "POST",
  });
}

export async function syncDevToAllDaemons(): Promise<{
  ok: boolean;
  results: Array<{ daemonId: string; ok: boolean; error?: string }>;
}> {
  return await instanceFetch(`${DEVELOPER_API}/daemon/sync-dev`, {
    method: "POST",
  });
}

export async function setInstanceTunnelToken(
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  return await instanceFetch(`${DEVELOPER_API}/instance/tunnel-token`, {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function formatEvent(
  event: DaemonEvent,
  connections: DaemonConnection[] = [],
): string {
  const time = new Date(event.at).toLocaleTimeString();
  const label = (daemonId: string) => daemonLabel(daemonId, connections);
  switch (event.kind) {
    case "connected":
      return `${time}  ${label(event.daemonId)} connected`;
    case "disconnected":
      return `${time}  ${label(event.daemonId)} disconnected`;
    case "broadcast":
      return `${time}  broadcast sent=${event.sent} ${
        JSON.stringify(event.payload)
      }`;
    case "message": {
      const arrow = event.direction === "in" ? "←" : "→";
      const detail = event.message.type === "echo"
        ? JSON.stringify(event.message.payload)
        : event.message.type;
      return `${time}  ${label(event.daemonId)} ${arrow} ${detail}`;
    }
  }
}

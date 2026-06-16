import { INSTANCE_DIR, TURBOPANEL_ROOT } from "@turbopanel/paths";

const STUDIO_PORT = 4983;
const STUDIO_BROWSER_URL = "https://local.drizzle.studio";
const NODE_BIN = "/opt/turbopanel/runtimes/node/current/bin/node";
const DRIZZLE_KIT = `${INSTANCE_DIR}/node_modules/drizzle-kit/bin.cjs`;
const STUDIO_CONFIG = `${INSTANCE_DIR}/.local/drizzle-studio.config.mjs`;

let studioChild: Deno.ChildProcess | null = null;

function parseEnvFile(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    values.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return values;
}

function readDatabaseUrl(): string | null {
  try {
    const envPath = `${INSTANCE_DIR}/.env`;
    const values = parseEnvFile(Deno.readTextFileSync(envPath));
    const url = values.get("TURBOPANEL_DATABASE_URL")?.trim();
    return url || null;
  } catch {
    return null;
  }
}

async function writeStudioConfig(databaseUrl: string): Promise<void> {
  const proc = await new Deno.Command(NODE_BIN, {
    args: [
      `${INSTANCE_DIR}/scripts/write-drizzle-studio-config.mjs`,
      databaseUrl,
      STUDIO_CONFIG,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!proc.success) {
    const err = new TextDecoder().decode(proc.stderr).trim();
    throw new Error(err || "failed to write drizzle studio config");
  }
}

export function drizzleStudioOpenUrl(): string {
  const params = new URLSearchParams({
    host: "localhost",
    port: String(STUDIO_PORT),
  });
  return `${STUDIO_BROWSER_URL}?${params.toString()}`;
}

async function probeStudioPort(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${STUDIO_PORT}/`, {
      signal: AbortSignal.timeout(800),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function fetchLocalDrizzleStudioStatus(): Promise<{
  running: boolean;
  browserUrl: string;
  port: number;
}> {
  const running = await probeStudioPort();
  return { running, browserUrl: drizzleStudioOpenUrl(), port: STUDIO_PORT };
}

async function isStudioChildAlive(): Promise<boolean> {
  if (!studioChild) return false;
  const status = await Promise.race([
    studioChild.status,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 0)),
  ]);
  return status === null;
}

export async function startLocalDrizzleStudio(): Promise<{
  ok: boolean;
  browserUrl: string;
  port: number;
}> {
  if (await probeStudioPort()) {
    return { ok: true, browserUrl: drizzleStudioOpenUrl(), port: STUDIO_PORT };
  }

  if (studioChild && await isStudioChildAlive()) {
    return { ok: true, browserUrl: drizzleStudioOpenUrl(), port: STUDIO_PORT };
  }

  const databaseUrl = readDatabaseUrl();
  if (!databaseUrl) {
    throw new Error(
      "TURBOPANEL_DATABASE_URL missing in instance/.env — switch to Workers mode again or run Start dev stack",
    );
  }

  await writeStudioConfig(databaseUrl);

  studioChild = new Deno.Command(NODE_BIN, {
    args: [
      DRIZZLE_KIT,
      "studio",
      "--config",
      STUDIO_CONFIG,
      "--host",
      "127.0.0.1",
      "--port",
      String(STUDIO_PORT),
    ],
    cwd: INSTANCE_DIR,
    env: { ...Deno.env.toObject(), HOME: TURBOPANEL_ROOT },
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();

  studioChild.status.then(() => {
    studioChild = null;
  }).catch(() => {
    studioChild = null;
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await probeStudioPort()) {
      return { ok: true, browserUrl: drizzleStudioOpenUrl(), port: STUDIO_PORT };
    }
    if (!(await isStudioChildAlive())) {
      throw new Error("drizzle studio exited before becoming ready");
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error("drizzle studio did not become ready in time");
}

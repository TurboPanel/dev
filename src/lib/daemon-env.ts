import {
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveDevIdentity } from "./dev-identity.ts";
import {
  buildPlatformRepoEntries,
  DAEMON_ENV_PATH,
  DAEMON_ENV_TRUNK_BRANCH_KEY,
  platformCaCertPath,
  resolveDevRoot,
  TURBOPANEL_TRUNK_BRANCH,
} from "./paths.ts";
import { caddyBrowserUrl } from "./service-urls.ts";

const INSTANCE_OPT_IN_KEY = "TURBOPANEL_DEV_INSTANCE";
const RUNTIME_KEY = "TURBOPANEL_INSTANCE_RUNTIME";
const WORKERS_INSTANCE_URL_KEYS = [
  "TURBOPANEL_INSTANCE_URL",
  "TURBOPANEL_INSTANCE_CA",
] as const;

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

function writeEnvFile(path: string, content: string): void {
  try {
    writeFileSync(path, content);
    return;
  } catch {
    // Fall through when the config dir isn't yet writable by the dev user.
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "turbopanel-env-"));
  const tmpPath = join(tmpDir, "daemon.env");
  try {
    writeFileSync(tmpPath, content);
    // /etc/turbopanel may not exist yet on the very first run (before any converge).
    const mkdir = spawnSync("sudo", ["-n", "mkdir", "-p", dirname(path)], {
      stdio: "ignore",
    });
    if (mkdir.status !== 0) {
      throw new Error(`Failed to create ${dirname(path)}`);
    }
    const result = spawnSync("sudo", ["-n", "cp", tmpPath, path], {
      stdio: "inherit",
    });
    if (result.status !== 0) {
      throw new Error(`Failed to write ${path}`);
    }
    const dev = resolveDevIdentity();
    spawnSync(
      "sudo",
      ["-n", "chown", `${dev.user}:${dev.gid}`, path],
      { stdio: "ignore" },
    );
  } finally {
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore
    }
  }
}

/** Build the managed daemon.env entries the dev console writes (testable contract). */
export function buildDaemonBaseEnvEntries(
  extra?: Record<string, string>,
): Record<string, string> {
  const dev = resolveDevIdentity();
  return {
    TURBOPANEL_MODE: "development",
    TURBOPANEL_DEV_ROOT: resolveDevRoot(),
    ...buildPlatformRepoEntries(),
    [DAEMON_ENV_TRUNK_BRANCH_KEY]: TURBOPANEL_TRUNK_BRANCH,
    TURBOPANEL_DEV_USER: dev.user,
    TURBOPANEL_DEV_UID: String(dev.uid),
    TURBOPANEL_DEV_GID: String(dev.gid),
    ...extra,
  };
}

function buildDaemonBaseEntries(extra?: Record<string, string>): Record<string, string> {
  return buildDaemonBaseEnvEntries(extra);
}

function mergeDaemonEnv(
  entries: Record<string, string>,
  options?: { removeKeys?: string[] },
): void {
  const managedKeys = new Set(Object.keys(entries));
  const removeKeys = new Set(options?.removeKeys ?? []);
  const updated = new Set<string>();
  const lines: string[] = [];
  const content = readEnvFile(DAEMON_ENV_PATH);

  if (content.length > 0) {
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
      if (match) {
        const key = match[1]!;
        if (removeKeys.has(key)) {
          continue;
        }
        if (managedKeys.has(key)) {
          if (!updated.has(key)) {
            lines.push(`${key}=${entries[key]}`);
            updated.add(key);
          }
          continue;
        }
      }
      lines.push(line);
    }
  }

  for (const [key, value] of Object.entries(entries)) {
    if (!updated.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  writeEnvFile(DAEMON_ENV_PATH, `${lines.join("\n")}\n`);
}

/** Write co-located dev identity keys without the instance activation marker. */
export function writeDaemonBaseEnv(extra?: Record<string, string>): void {
  mergeDaemonEnv(buildDaemonBaseEntries(extra), {
    removeKeys: [INSTANCE_OPT_IN_KEY],
  });
}

function resolveRuntimeForWrite(
  extra?: Record<string, string>,
): "deno" | "workers" {
  if (extra?.[RUNTIME_KEY] === "workers") {
    return "workers";
  }
  if (extra?.[RUNTIME_KEY] === "deno") {
    return "deno";
  }
  return readInstanceRuntime();
}

/**
 * Opt in to co-located instance provisioning via the daemon `.env` marker.
 *
 * Also applies runtime-aware daemon connectivity: workers mode writes
 * `TURBOPANEL_INSTANCE_URL` + `TURBOPANEL_INSTANCE_CA`; deno mode removes them
 * so the daemon falls back to the local Unix socket.
 */
export function writeDaemonInstanceEnv(extra?: Record<string, string>): void {
  const runtime = resolveRuntimeForWrite(extra);
  const entries: Record<string, string> = {
    ...buildDaemonBaseEntries(),
    [INSTANCE_OPT_IN_KEY]: "1",
    ...extra,
  };
  const removeKeys: string[] = [];

  if (runtime === "workers") {
    entries.TURBOPANEL_INSTANCE_URL = caddyBrowserUrl();
    entries.TURBOPANEL_INSTANCE_CA = platformCaCertPath();
  } else {
    removeKeys.push(...WORKERS_INSTANCE_URL_KEYS);
  }

  mergeDaemonEnv(entries, { removeKeys });
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

function readDaemonEnvEntries(): Map<string, string> {
  return parseEnvEntries(readEnvFile(DAEMON_ENV_PATH));
}

export function readInstanceRuntime(): "deno" | "workers" {
  const runtime = readDaemonEnvEntries().get("TURBOPANEL_INSTANCE_RUNTIME");
  return runtime === "workers" ? "workers" : "deno";
}

export function isDevInstanceEnabled(): boolean {
  return readDaemonEnvEntries().get(INSTANCE_OPT_IN_KEY) === "1";
}

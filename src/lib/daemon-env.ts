import {
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveDevIdentity } from "./dev-identity.ts";
import { DAEMON_ENV_PATH, DAEMON_REPO_DIR } from "./paths.ts";

const INSTANCE_OPT_IN_KEY = "TURBOPANEL_DEV_INSTANCE";

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
    // Fall through when the checkout is turbopanel-owned.
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "turbopanel-env-"));
  const tmpPath = join(tmpDir, "daemon.env");
  try {
    writeFileSync(tmpPath, content);
    const result = spawnSync("sudo", ["-n", "cp", tmpPath, path], {
      stdio: "inherit",
    });
    if (result.status !== 0) {
      throw new Error(`Failed to write ${path}`);
    }
    spawnSync(
      "sudo",
      ["-n", "chown", "turbopanel:turbopanel", path],
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

function buildDaemonBaseEntries(extra?: Record<string, string>): Record<string, string> {
  const dev = resolveDevIdentity();
  return {
    TURBOPANEL_TRUNK_BRANCH: "trunk",
    TURBOPANEL_DAEMON_STATE_DIR: DAEMON_REPO_DIR,
    TURBOPANEL_DEV_USER: dev.user,
    TURBOPANEL_DEV_UID: String(dev.uid),
    TURBOPANEL_DEV_GID: String(dev.gid),
    ...extra,
  };
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

/** Opt in to co-located instance provisioning via the daemon `.env` marker. */
export function writeDaemonInstanceEnv(extra?: Record<string, string>): void {
  mergeDaemonEnv({
    ...buildDaemonBaseEntries(),
    [INSTANCE_OPT_IN_KEY]: "1",
    ...extra,
  });
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

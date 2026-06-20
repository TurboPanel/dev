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

/** Merge co-located dev daemon `.env` keys (legacy console contract). */
export function writeDaemonEnv(extra?: Record<string, string>): void {
  const dev = resolveDevIdentity();
  const entries: Record<string, string> = {
    TURBOPANEL_DEV_INSTANCE: "1",
    TURBOPANEL_TRUNK_BRANCH: "trunk",
    TURBOPANEL_DAEMON_STATE_DIR: DAEMON_REPO_DIR,
    TURBOPANEL_DEV_USER: dev.user,
    TURBOPANEL_DEV_UID: String(dev.uid),
    TURBOPANEL_DEV_GID: String(dev.gid),
    ...extra,
  };

  const managedKeys = new Set(Object.keys(entries));
  const updated = new Set<string>();
  const lines: string[] = [];
  const content = readEnvFile(DAEMON_ENV_PATH);

  if (content.length > 0) {
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
      if (match && managedKeys.has(match[1]!)) {
        if (!updated.has(match[1]!)) {
          lines.push(`${match[1]}=${entries[match[1]!]}`);
          updated.add(match[1]!);
        }
        continue;
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

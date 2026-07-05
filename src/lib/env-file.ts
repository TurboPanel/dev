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

export function readEnvFile(path: string): string {
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

export function writeEnvFile(path: string, content: string): void {
  try {
    writeFileSync(path, content);
    return;
  } catch {
    // Fall through when the config dir isn't yet writable by the dev user.
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "turbopanel-env-"));
  const tmpPath = join(tmpDir, "env");
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

export function parseEnvEntries(content: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of content.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      entries.set(match[1]!, match[2]!);
    }
  }
  return entries;
}

export function mergeEnvFile(
  path: string,
  entries: Record<string, string>,
  options?: { removeKeys?: string[] },
): void {
  const managedKeys = new Set(Object.keys(entries));
  const removeKeys = new Set(options?.removeKeys ?? []);
  const updated = new Set<string>();
  const lines: string[] = [];
  const content = readEnvFile(path);

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

  writeEnvFile(path, `${lines.join("\n")}\n`);
}

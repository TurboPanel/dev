import { DAEMON_ENV_PATH } from "@turbopanel/lib/paths.ts";

function readEnvFileContent(path: string): string {
  try {
    return Deno.readTextFileSync(path);
  } catch {
    const proc = new Deno.Command("sudo", {
      args: ["cat", path],
      stdout: "piped",
      stderr: "null",
    }).outputSync();
    if (!proc.success) {
      return "";
    }
    return new TextDecoder().decode(proc.stdout);
  }
}

/** Parsed key/value pairs from the daemon `.env` checkout file. */
export function loadDaemonEnvMap(): Map<string, string> {
  const values = new Map<string, string>();
  const content = readEnvFileContent(DAEMON_ENV_PATH);
  for (const line of content.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      values.set(match[1], match[2]);
    }
  }
  return values;
}

/** Flat `KEY=value` strings suitable for `sudo env …`. */
export function daemonEnvAssignments(): string[] {
  return [...loadDaemonEnvMap()].map(([key, value]) => `${key}=${value}`);
}

/** Merge daemon `.env` into the current process environment (does not override). */
export function applyDaemonEnvToProcess(): void {
  for (const [key, value] of loadDaemonEnvMap()) {
    if (!Deno.env.has(key)) {
      Deno.env.set(key, value);
    }
  }
}

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function readLogFileText(path: string): string | undefined {
  try {
    if (existsSync(path)) {
      return readFileSync(path, "utf8");
    }
  } catch {
    // fall through to sudo cat
  }

  const result = spawnSync(
    "sudo",
    ["-n", "cat", path],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0 || result.stdout === undefined) {
    return undefined;
  }
  return result.stdout;
}

/** Incremental tail of one or more append-only service log files. */
export class LogFileTailer {
  private readonly offsets = new Map<string, number>();

  constructor(paths: readonly string[]) {
    for (const path of paths) {
      this.offsets.set(path, readLogFileText(path)?.length ?? 0);
    }
  }

  drain(onLine: (line: string) => void): void {
    for (const path of this.offsets.keys()) {
      const text = readLogFileText(path);
      if (text === undefined) {
        continue;
      }

      let offset = this.offsets.get(path) ?? 0;
      if (text.length < offset) {
        offset = 0;
      }

      const chunk = text.slice(offset);
      this.offsets.set(path, text.length);

      if (chunk.length === 0) {
        continue;
      }

      const parts = chunk.split("\n");
      const endsWithNewline = chunk.endsWith("\n");
      const completeLines = endsWithNewline ? parts : parts.slice(0, -1);

      for (const line of completeLines) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          onLine(trimmed);
        }
      }
    }
  }
}

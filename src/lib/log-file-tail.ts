import { closeSync, openSync, readSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

function fileSize(path: string): number | undefined {
  try {
    return statSync(path).size;
  } catch {
    // fall through to sudo stat
  }

  const result = spawnSync(
    "sudo",
    ["-n", "stat", "-c", "%s", path],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  if (result.status !== 0 || !result.stdout) {
    return undefined;
  }
  const size = Number(result.stdout.trim());
  return Number.isFinite(size) ? size : undefined;
}

/** Read only `[start, start + length)`; never loads the whole file into memory. */
function readChunkFrom(
  path: string,
  start: number,
  length: number,
): string | undefined {
  if (length <= 0) {
    return "";
  }
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = readSync(fd, buffer, 0, length, start);
    return buffer.toString("utf8", 0, bytesRead);
  } catch {
    // fall through to sudo tail
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }

  const result = spawnSync(
    "sudo",
    ["-n", "tail", "-c", `+${start + 1}`, path],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: length + 1024,
    },
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
      this.offsets.set(path, fileSize(path) ?? 0);
    }
  }

  drain(onLine: (line: string) => void): void {
    for (const path of this.offsets.keys()) {
      const size = fileSize(path);
      if (size === undefined) {
        continue;
      }

      let offset = this.offsets.get(path) ?? 0;
      if (size < offset) {
        offset = 0;
      }
      if (size === offset) {
        continue;
      }

      const chunk = readChunkFrom(path, offset, size - offset);
      if (chunk === undefined) {
        continue;
      }
      this.offsets.set(path, size);

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

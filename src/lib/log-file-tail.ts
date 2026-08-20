import { closeSync, openSync, readSync, statSync } from "node:fs";
import { spawnSyncTrustedText } from "./spawn-trusted.ts";

function fileSize(path: string): number | undefined {
  try {
    return statSync(path).size;
  } catch {
    // fall through to sudo stat
  }

  const result = spawnSyncTrustedText(
    "sudo",
    ["-n", "stat", "-c", "%s", path],
    { stdio: ["ignore", "pipe", "ignore"] },
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

  const result = spawnSyncTrustedText(
    "sudo",
    ["-n", "tail", "-c", `+${start + 1}`, path],
    {
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: length + 1024,
    },
  );
  if (result.status !== 0 || result.stdout === undefined) {
    return undefined;
  }
  return result.stdout;
}

function emitCompleteLines(
  chunk: string,
  onLine: (line: string) => void,
): void {
  const parts = chunk.split("\n");
  const completeLines = chunk.endsWith("\n") ? parts : parts.slice(0, -1);
  for (const line of completeLines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      onLine(trimmed);
    }
  }
}

/** Incremental tail of one or more append-only service log files. */
export class LogFileTailer {
  private readonly offsets = new Map<string, number>();

  constructor(paths: readonly string[]) {
    for (const path of paths) {
      this.offsets.set(path, fileSize(path) ?? 0);
    }
  }

  private drainPath(path: string, onLine: (line: string) => void): void {
    const size = fileSize(path);
    if (size === undefined) {
      return;
    }

    let offset = this.offsets.get(path) ?? 0;
    if (size < offset) {
      offset = 0;
    }
    if (size === offset) {
      return;
    }

    const chunk = readChunkFrom(path, offset, size - offset);
    if (chunk === undefined) {
      return;
    }
    this.offsets.set(path, size);

    if (chunk.length === 0) {
      return;
    }
    emitCompleteLines(chunk, onLine);
  }

  drain(onLine: (line: string) => void): void {
    for (const path of this.offsets.keys()) {
      this.drainPath(path, onLine);
    }
  }
}

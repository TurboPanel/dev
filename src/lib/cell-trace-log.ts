import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readSync,
} from "node:fs";
import { STRUCTURED_TEXT_WITH_TIME_RE } from "./daemon-log.ts";
import {
  type ServiceLogByteFloor,
  type ServiceLogLine,
  SERVICE_FILE_LOG_PATHS,
  readServiceLogFileStat,
} from "./service-log.ts";

const CELL_TRACE_COMPONENTS = new Set(["daemon-cell", "command-consumer"]);
const DAEMON_CELL_TOKEN = "daemon-cell";

const TAIL_BYTES_PER_LINE = 4 * 1024;
const TAIL_MIN_BYTES = 64 * 1024;

function parseServiceLine(text: string): ServiceLogLine {
  const match = STRUCTURED_TEXT_WITH_TIME_RE.exec(text);
  if (match) {
    const time = match[1];
    return { text: text.slice(time.length).trimStart(), time };
  }
  return { text };
}

function isCellTraceLine(rawLine: string): boolean {
  if (rawLine.includes(DAEMON_CELL_TOKEN)) {
    return true;
  }

  const match = STRUCTURED_TEXT_WITH_TIME_RE.exec(rawLine);
  if (!match) {
    return false;
  }

  return CELL_TRACE_COMPONENTS.has(match[3]!);
}

function readFileTailText(
  path: string,
  maxLines: number,
  minByteOffset = 0,
): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const { size } = fstatSync(fd);
    if (size <= 0) {
      return "";
    }
    const maxBytes = Math.max(TAIL_MIN_BYTES, maxLines * TAIL_BYTES_PER_LINE);
    const tailStart = size > maxBytes ? size - maxBytes : 0;
    const start = Math.max(minByteOffset, tailStart);
    const length = size - start;
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = readSync(fd, buffer, 0, length, start);
    let text = buffer.toString("utf8", 0, bytesRead);
    if (start > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline === -1 ? "" : text.slice(firstNewline + 1);
    }
    return text;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

export function readCellTraceLogFileStat(): ServiceLogByteFloor {
  return readServiceLogFileStat("instance");
}

export function readCellTraceLogTail(
  maxLines = 500,
  byteFloor?: ServiceLogByteFloor | null,
): ServiceLogLine[] {
  const paths = SERVICE_FILE_LOG_PATHS.instance ?? [];
  const collected: string[] = [];

  for (const path of paths) {
    if (!existsSync(path)) {
      continue;
    }
    const text = readFileTailText(path, maxLines, byteFloor?.[path] ?? 0);
    if (text === undefined || text.length === 0) {
      continue;
    }
    collected.push(
      ...text
        .split("\n")
        .filter((line) => line.trim().length > 0),
    );
  }

  const filtered = collected.filter(isCellTraceLine);

  if (filtered.length === 0) {
    return [parseServiceLine("No cell trace lines yet — enable verbose cell trace and restart instance")];
  }

  return filtered.slice(-maxLines).map(parseServiceLine);
}

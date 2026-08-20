import { closeSync, openSync, readSync, statSync } from "node:fs";
import { isDaemonServiceActive } from "./daemon-actions.ts";
import { DAEMON_ERR_LOG_PATH, DAEMON_LOG_PATH, DAEMON_SYSTEMD_UNIT } from "./paths.ts";
import { sanitizeInstallOutput } from "./install-output.ts";
import { spawnSyncTrustedText } from "./spawn-trusted.ts";

const HIDE_ANSIBLE_DEBUG = true;

export type StructuredTextWithTime = {
  time: string;
  level: string;
  component: string;
  rest: string;
};

/** Parse daemon/instance structured log lines without backtracking-prone regexes. */
export function parseStructuredTextWithTime(
  trimmed: string,
): StructuredTextWithTime | null {
  const timeMatch = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+/.exec(trimmed);
  if (!timeMatch) {
    return null;
  }

  let rest = trimmed.slice(timeMatch[0].length);
  const levelMatch = /^(DEBUG|INFO|WARN|ERROR)\s+/.exec(rest);
  if (!levelMatch) {
    return null;
  }

  rest = rest.slice(levelMatch[0].length);
  const componentMatch = /^(\S+)\s{2,}/.exec(rest);
  if (!componentMatch) {
    return null;
  }

  return {
    time: timeMatch[1]!,
    level: levelMatch[1]!,
    component: componentMatch[1]!,
    rest: rest.slice(componentMatch[0].length),
  };
}

const WAITING_MESSAGE_RE = /^waiting(?:\s+for\s+instance)?$/i;

export type DaemonLogLevel = "debug" | "info" | "warn" | "error";

export type DaemonLogLine = {
  time: string;
  level: DaemonLogLevel;
  component: string;
  message: string;
  err?: string;
};

function normalizeLevel(level: string): DaemonLogLevel {
  const lower = level.toLowerCase();
  if (
    lower === "debug" ||
    lower === "info" ||
    lower === "warn" ||
    lower === "error"
  ) {
    return lower;
  }
  return "info";
}

function splitMessageAndErr(text: string): { message: string; err?: string } {
  const close = text.lastIndexOf(")");
  if (close <= 0) {
    return { message: text };
  }

  const open = text.lastIndexOf("(", close - 1);
  if (open <= 0 || text[open - 1] !== " ") {
    return { message: text };
  }

  return {
    message: text.slice(0, open - 1).trimEnd(),
    err: text.slice(open + 1, close),
  };
}

function waitingMessage(message: string): string {
  return WAITING_MESSAGE_RE.test(message.trim())
    ? "waiting for instance"
    : message;
}

function structuredLine(
  time: string,
  level: DaemonLogLevel,
  component: string,
  message: string,
  err?: string,
): DaemonLogLine {
  return {
    time: time.trim(),
    level,
    component,
    message: waitingMessage(message),
    err,
  };
}

export const LOG_TIME_PLACEHOLDER = "──:──:──";
export const LOG_TIME_WIDTH = 8;

export function formatLogDisplayTime(iso: string): string {
  if (!iso) {
    return LOG_TIME_PLACEHOLDER;
  }
  const parsed = new Date(iso);
  if (!Number.isNaN(parsed.getTime())) {
    const hh = String(parsed.getHours()).padStart(2, "0");
    const mm = String(parsed.getMinutes()).padStart(2, "0");
    const ss = String(parsed.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  return iso;
}

export function parseDaemonLogLine(raw: string): DaemonLogLine | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{")) {
    try {
      const payload = JSON.parse(trimmed) as {
        time?: string;
        level?: string;
        component?: string;
        msg?: string;
        err?: string;
      };
      if (payload.component && payload.msg) {
        return structuredLine(
          payload.time ?? "",
          normalizeLevel(payload.level ?? "info"),
          payload.component,
          payload.msg,
          payload.err,
        );
      }
    } catch {
      return null;
    }
  }

  const withTime = parseStructuredTextWithTime(trimmed);
  if (withTime) {
    const { message, err } = splitMessageAndErr(withTime.rest);
    return structuredLine(
      withTime.time,
      normalizeLevel(withTime.level),
      withTime.component,
      message,
      err,
    );
  }

  return null;
}

function collapseKey(line: DaemonLogLine): string {
  return `${line.component}\0${line.message}`;
}

function collapseConsecutiveLines(lines: DaemonLogLine[]): DaemonLogLine[] {
  const collapsed: DaemonLogLine[] = [];
  let lastKey: string | undefined;

  for (const line of lines) {
    const key = collapseKey(line);
    if (lastKey === key) {
      // Keep the newest timestamp when status lines repeat (e.g. docker-monitor polls).
      collapsed[collapsed.length - 1] = line;
      continue;
    }
    lastKey = key;
    collapsed.push(line);
  }

  return collapsed;
}

type RawLogLine = {
  text: string;
  offset: number;
};

type FileTailMeta = {
  path: string;
  readable: boolean;
  lines: RawLogLine[];
  birthMs: number;
  mtimeMs: number;
  size: number;
};

// Per-line byte budget for tail reads. Daemon logs can include Ansible output
// and stack traces; 4 KB/line keeps the tail window generous while never
// loading a multi-hundred-MB log file fully into memory.
const TAIL_BYTES_PER_LINE = 4 * 1024;
const TAIL_MIN_BYTES = 64 * 1024;

function fileStatMs(path: string): { birthMs: number; mtimeMs: number; size: number } | undefined {
  try {
    const st = statSync(path);
    return {
      birthMs: st.birthtimeMs || st.ctimeMs,
      mtimeMs: st.mtimeMs,
      size: st.size,
    };
  } catch {
    return undefined;
  }
}

function sudoFileStatMs(path: string): { birthMs: number; mtimeMs: number; size: number } | undefined {
  const result = spawnSyncTrustedText(
    "sudo",
    ["-n", "stat", "-c", "%W %Y %s", path],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  if (result.status !== 0 || !result.stdout) {
    return undefined;
  }
  const [birthSec, mtimeSec, sizeText] = result.stdout.trim().split(/\s+/);
  const birth = Number(birthSec);
  const mtime = Number(mtimeSec);
  const size = Number(sizeText);
  if (!Number.isFinite(mtime) || !Number.isFinite(size)) {
    return undefined;
  }
  return {
    birthMs: birth > 0 ? birth * 1000 : mtime * 1000,
    mtimeMs: mtime * 1000,
    size,
  };
}

function splitLinesWithOffsets(text: string): RawLogLine[] {
  const lines: RawLogLine[] = [];
  let offset = 0;
  const parts = text.split("\n");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;
    if (!isLast || part.length > 0) {
      lines.push({ text: part, offset });
    }
    offset += part.length + (isLast ? 0 : 1);
  }
  return lines;
}

/**
 * Read only the final `length` bytes of a file starting at `start`, instead of
 * loading the whole file. Append-only daemon logs can grow to hundreds of MB; a
 * full read on every 1s poll exhausts the heap.
 */
function readLogFileChunk(
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
    ["-n", "tail", "-c", String(length), path],
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

function tailLinesWithMeta(
  path: string,
  maxLines: number,
  minByteOffset = 0,
): FileTailMeta {
  const empty: FileTailMeta = {
    path,
    readable: false,
    lines: [],
    birthMs: 0,
    mtimeMs: 0,
    size: 0,
  };

  const stat = fileStatMs(path) ?? sudoFileStatMs(path);
  if (!stat) {
    return empty;
  }

  const maxBytes = Math.max(TAIL_MIN_BYTES, maxLines * TAIL_BYTES_PER_LINE);
  const start = stat.size > maxBytes ? stat.size - maxBytes : 0;
  const text = readLogFileChunk(path, start, stat.size - start);
  if (text === undefined) {
    return empty;
  }

  const effectiveFloor = stat.size < minByteOffset ? 0 : minByteOffset;

  // Offsets are absolute file positions; drop the first (partial) line when the
  // tail window did not start at the beginning of the file.
  const rawLines = splitLinesWithOffsets(text).map((line) => ({
    text: line.text,
    offset: start + line.offset,
  }));
  const completeLines = start > 0 ? rawLines.slice(1) : rawLines;

  const lines = completeLines
    .map((line) => ({
      text: sanitizeInstallOutput(line.text),
      offset: line.offset,
    }))
    .filter((line) => line.text.trim().length > 0 && line.offset >= effectiveFloor)
    .slice(-maxLines);

  return {
    path,
    readable: true,
    lines,
    birthMs: stat.birthMs,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

function parseTailedFile(meta: FileTailMeta): DaemonLogLine[] {
  return meta.lines
    .map((line) => parseDaemonLogLine(line.text))
    .filter((line): line is DaemonLogLine => line !== null)
    .filter((line) => !shouldHideDaemonLogLine(line));
}

function isDockerMonitorPollLine(line: DaemonLogLine): boolean {
  return (
    line.component === "docker-monitor" &&
    line.level === "info" &&
    /^\d+ containers:/.test(line.message)
  );
}

export function shouldHideDaemonLogLine(line: DaemonLogLine): boolean {
  if (isDockerMonitorPollLine(line)) {
    return true;
  }
  if (HIDE_ANSIBLE_DEBUG && line.component === "ansible" && line.level === "debug") {
    return true;
  }
  return false;
}

function emptyLogHints(
  stdout: FileTailMeta,
  stderr: FileTailMeta,
): DaemonLogLine[] {
  const now = new Date().toISOString();
  if (!stdout.readable && !stderr.readable) {
    return [
      structuredLine(
        now,
        "warn",
        "console",
        `No daemon logs readable — expected ${DAEMON_LOG_PATH}`,
      ),
      structuredLine(
        now,
        "info",
        "console",
        "Ensure passwordless sudo is enabled for tail, or ask an admin for log access.",
      ),
    ];
  }

  if (!isDaemonServiceActive()) {
    return [
      structuredLine(
        now,
        "info",
        "console",
        `${DAEMON_SYSTEMD_UNIT} is not running — logs appear once the service starts`,
      ),
      structuredLine(
        now,
        "info",
        "console",
        "Install or repair the daemon, or run Converge / re-converge from the Developer menu",
      ),
    ];
  }

  return [
    structuredLine(
      now,
      "warn",
      "console",
      "Daemon stdout log is empty — the service may be crash-looping before structured logging starts",
    ),
    structuredLine(
      now,
      "info",
      "console",
      stderr.readable
        ? "Showing stderr from daemon.err.log — fix permission or startup errors below"
        : `Check ${DAEMON_ERR_LOG_PATH} for startup errors`,
    ),
  ];
}

function collapseRepeatedStatus(lines: DaemonLogLine[]): DaemonLogLine[] {
  const collapsed = collapseConsecutiveLines(lines);
  const keep: DaemonLogLine[] = [];
  const state = {
    sawWaiting: false,
    sawDockerPoll: false,
    lastRecapKey: undefined as string | undefined,
    lastRecapIndex: undefined as number | undefined,
  };

  for (const line of collapsed) {
    if (appendDedupedStatusLine(line, keep, state)) {
      continue;
    }
    state.lastRecapKey = undefined;
    state.lastRecapIndex = undefined;
    keep.push(line);
  }

  return keep;
}

function appendDedupedStatusLine(
  line: DaemonLogLine,
  keep: DaemonLogLine[],
  state: {
    sawWaiting: boolean;
    sawDockerPoll: boolean;
    lastRecapKey: string | undefined;
    lastRecapIndex: number | undefined;
  },
): boolean {
  if (line.component === "instance" && line.message === "waiting for instance") {
    if (!state.sawWaiting) {
      keep.push(line);
      state.sawWaiting = true;
    }
    return true;
  }
  if (
    line.component === "docker" &&
    line.message === "monitor poll failed (check Docker socket access)"
  ) {
    if (!state.sawDockerPoll) {
      keep.push(line);
      state.sawDockerPoll = true;
    }
    return true;
  }
  if (line.component === "ansible" && line.message.startsWith("[recap]")) {
    const key = collapseKey(line);
    if (state.lastRecapKey === key && state.lastRecapIndex !== undefined) {
      keep[state.lastRecapIndex] = line;
    } else {
      keep.push(line);
      state.lastRecapKey = key;
      state.lastRecapIndex = keep.length - 1;
    }
    return true;
  }
  return false;
}

export type DaemonLogFileStat = {
  stdoutSize: number;
  stdoutMtimeMs: number;
  stderrSize: number;
  stderrMtimeMs: number;
};

/** Show only log bytes appended at or after these file offsets (post-restart view). */
export type DaemonLogByteFloor = {
  stdout: number;
  stderr: number;
};

export function readDaemonLogFileStat(): DaemonLogFileStat {
  const stdout = fileStatMs(DAEMON_LOG_PATH) ?? sudoFileStatMs(DAEMON_LOG_PATH);
  const stderr = fileStatMs(DAEMON_ERR_LOG_PATH) ?? sudoFileStatMs(DAEMON_ERR_LOG_PATH);
  return {
    stdoutSize: stdout?.size ?? 0,
    stdoutMtimeMs: stdout?.mtimeMs ?? 0,
    stderrSize: stderr?.size ?? 0,
    stderrMtimeMs: stderr?.mtimeMs ?? 0,
  };
}

export function readDaemonLogTail(
  maxLines = 500,
  byteFloor?: DaemonLogByteFloor | null,
): DaemonLogLine[] {
  const stdoutBudget = Math.max(1, Math.round(maxLines * 0.8));
  const stderrBudget = Math.max(1, maxLines - stdoutBudget);
  const stdout = tailLinesWithMeta(
    DAEMON_LOG_PATH,
    stdoutBudget,
    byteFloor?.stdout ?? 0,
  );
  const stderr = tailLinesWithMeta(
    DAEMON_ERR_LOG_PATH,
    stderrBudget,
    byteFloor?.stderr ?? 0,
  );
  const lines = [
    ...parseTailedFile(stdout),
    ...parseTailedFile(stderr),
  ];

  if (lines.length === 0) {
    return emptyLogHints(stdout, stderr);
  }

  return collapseRepeatedStatus(lines.slice(-maxLines));
}

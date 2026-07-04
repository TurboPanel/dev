import { closeSync, openSync, readSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isDaemonServiceActive } from "./daemon-actions.ts";
import { DAEMON_ERR_LOG_PATH, DAEMON_LOG_PATH, DAEMON_SYSTEMD_UNIT } from "./paths.ts";
import { sanitizeInstallOutput } from "./install-output.ts";

const HIDE_ANSIBLE_DEBUG = true;

/** Legacy stderr noise before structured logging (skip when tailing old err.log). */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function isLegacyNoiseLine(raw: string): boolean {
  const trimmed = stripAnsi(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    return false;
  }
  if (/^(DEBUG|INFO|WARN|ERROR)\s/.test(trimmed)) {
    return false;
  }
  if (trimmed.startsWith("{")) {
    return false;
  }
  return (
    /^Warning/i.test(trimmed) ||
    /--env-file/.test(trimmed) ||
    /^Download\s+https?:\/\//i.test(trimmed) ||
    /^\[instance\] waiting for instance:/i.test(trimmed)
  );
}

export const STRUCTURED_TEXT_WITH_TIME_RE =
  /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(DEBUG|INFO|WARN|ERROR)\s+(\S+)\s{2,}(.*)$/;
const STRUCTURED_TEXT_RE =
  /^(DEBUG|INFO|WARN|ERROR)\s+(\S+)\s{2,}(.*)$/;
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
  const match = /^(.*)\s+\((.+)\)$/.exec(text);
  if (!match) {
    return { message: text };
  }
  return { message: match[1].trimEnd(), err: match[2] };
}

function waitingMessage(message: string): string {
  return WAITING_MESSAGE_RE.test(message.trim())
    ? "waiting for instance"
    : message;
}

function estimateTimeFromFilePosition(
  offset: number,
  size: number,
  birthMs: number,
  mtimeMs: number,
): string {
  if (size <= 0) {
    return new Date(mtimeMs).toISOString();
  }
  const span = Math.max(mtimeMs - birthMs, 0);
  const ratio = Math.min(Math.max(offset / size, 0), 1);
  return new Date(birthMs + ratio * span).toISOString();
}

function enrichLineTimestamps(
  lines: DaemonLogLine[],
  meta: Pick<FileTailMeta, "path" | "birthMs" | "mtimeMs" | "size">,
  offsets: number[],
): DaemonLogLine[] {
  return lines.map((line, index) => {
    if (line.time.trim().length > 0) {
      return line;
    }
    // Legacy fallback for log lines written before structured logging was introduced;
    // increasingly rare as old log files age out.
    const offset = offsets[index] ?? meta.size;
    return {
      ...line,
      time: cachedDerivedTimestamp(meta.path, offset, meta),
    };
  });
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

export function parseDaemonLogLine(raw: string): DaemonLogLine {
  const trimmed = raw.trim();

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
      // fall through
    }
  }

  const withTime = STRUCTURED_TEXT_WITH_TIME_RE.exec(trimmed);
  if (withTime) {
    const { message, err } = splitMessageAndErr(withTime[4]);
    return structuredLine(
      withTime[1],
      normalizeLevel(withTime[2]),
      withTime[3],
      message,
      err,
    );
  }

  const withoutTime = STRUCTURED_TEXT_RE.exec(trimmed);
  if (withoutTime) {
    const { message, err } = splitMessageAndErr(withoutTime[3]);
    return structuredLine(
      "",
      normalizeLevel(withoutTime[1]),
      withoutTime[2],
      message,
      err,
    );
  }

  if (
    trimmed === "waiting for instance" ||
    /^\[(?:daemon|instance)\] waiting for instance/.test(trimmed)
  ) {
    return structuredLine("", "info", "instance", "waiting for instance");
  }

  if (/^\[docker-monitor\] poll failed:/.test(trimmed)) {
    return structuredLine("", "warn", "docker", "monitor poll failed (check Docker socket access)");
  }

  if (/^\[docker\] Docker socket not reachable/.test(trimmed)) {
    return structuredLine("", "warn", "docker", "Docker socket not reachable yet");
  }

  if (
    /^Warning/i.test(trimmed) ||
    /--env-file/.test(trimmed) ||
    /^WARN\b/i.test(trimmed)
  ) {
    const message = trimmed.replace(/^Warning\s*/i, "");
    return structuredLine("", "warn", "deno", message);
  }

  return structuredLine("", "info", "daemon", trimmed);
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

const derivedTimestampCache = new Map<string, string>();
const derivedTimestampFileSize = new Map<string, number>();

// Per-line byte budget for tail reads. Daemon logs can include Ansible output
// and stack traces; 4 KB/line keeps the tail window generous while never
// loading a multi-hundred-MB log file fully into memory.
const TAIL_BYTES_PER_LINE = 4 * 1024;
const TAIL_MIN_BYTES = 64 * 1024;

function cachedDerivedTimestamp(
  path: string,
  offset: number,
  meta: Pick<FileTailMeta, "birthMs" | "mtimeMs" | "size">,
): string {
  const previousSize = derivedTimestampFileSize.get(path);
  if (previousSize !== undefined && meta.size < previousSize) {
    for (const key of derivedTimestampCache.keys()) {
      if (key.startsWith(`${path}:`)) {
        derivedTimestampCache.delete(key);
      }
    }
  }
  derivedTimestampFileSize.set(path, meta.size);

  const key = `${path}:${offset}`;
  const cached = derivedTimestampCache.get(key);
  if (cached) {
    return cached;
  }

  const derived = estimateTimeFromFilePosition(
    offset,
    meta.size,
    meta.birthMs,
    meta.mtimeMs,
  );
  derivedTimestampCache.set(key, derived);
  return derived;
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
  const result = spawnSync(
    "sudo",
    ["-n", "stat", "-c", "%W %Y %s", path],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
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

  const result = spawnSync(
    "sudo",
    ["-n", "tail", "-c", String(length), path],
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
  const filtered = meta.lines.filter((line) => !isLegacyNoiseLine(line.text));
  if (filtered.length === 0) {
    return [];
  }
  const parsed = filtered
    .map((line) => parseDaemonLogLine(line.text))
    .filter((line) => !shouldHideDaemonLogLine(line));
  return enrichLineTimestamps(
    parsed,
    meta,
    filtered.map((line) => line.offset),
  );
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
        "Install or repair the daemon, or run Start development environment from the Developer menu",
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
  let sawWaiting = false;
  let sawDockerPoll = false;
  let lastRecapKey: string | undefined;
  let lastRecapIndex: number | undefined;

  for (const line of collapsed) {
    if (line.component === "instance" && line.message === "waiting for instance") {
      if (!sawWaiting) {
        keep.push(line);
        sawWaiting = true;
      }
      continue;
    }
    if (
      line.component === "docker" &&
      line.message === "monitor poll failed (check Docker socket access)"
    ) {
      if (!sawDockerPoll) {
        keep.push(line);
        sawDockerPoll = true;
      }
      continue;
    }
    if (line.component === "ansible" && line.message.startsWith("[recap]")) {
      const key = collapseKey(line);
      if (lastRecapKey === key && lastRecapIndex !== undefined) {
        keep[lastRecapIndex] = line;
      } else {
        keep.push(line);
        lastRecapKey = key;
        lastRecapIndex = keep.length - 1;
      }
      continue;
    }
    lastRecapKey = undefined;
    lastRecapIndex = undefined;
    keep.push(line);
  }

  return keep;
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

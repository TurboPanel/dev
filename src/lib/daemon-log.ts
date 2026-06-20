import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isDaemonServiceActive } from "./daemon-actions.ts";
import { DAEMON_ERR_LOG_PATH, DAEMON_LOG_PATH } from "./paths.ts";
import { sanitizeInstallOutput } from "./install-output.ts";

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
    /^Python .* is already installed/i.test(trimmed) ||
    /^Download\s+https?:\/\//i.test(trimmed) ||
    /^\[instance\] waiting for instance:/i.test(trimmed)
  );
}

const STRUCTURED_TEXT_WITH_TIME_RE =
  /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(DEBUG|INFO|WARN|ERROR)\s+(\S+)\s{2,}(.*)$/;
const STRUCTURED_TEXT_RE =
  /^(DEBUG|INFO|WARN|ERROR)\s+(\S+)\s{2,}(.*)$/;
const WAITING_MESSAGE_RE = /^waiting(?:\s+for\s+instance)?$/i;
const ANSIBLE_LINE_RE =
  /^(TASK|PLAY|ok:|changed:|skipping:|ERROR!|WARNING:|fatal:)/i;

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
    const offset = offsets[index] ?? meta.size;
    return {
      ...line,
      time: cachedDerivedTimestamp(meta.path, offset, meta),
    };
  });
}

export const LOG_TIME_PLACEHOLDER = "──:──:──";

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

  if (ANSIBLE_LINE_RE.test(trimmed)) {
    return structuredLine("", "debug", "ansible", trimmed);
  }

  if (/Python .* is already installed/i.test(trimmed)) {
    return structuredLine("", "info", "orchestration", trimmed);
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

function tailLinesWithMeta(path: string, maxLines: number): FileTailMeta {
  const empty: FileTailMeta = {
    path,
    readable: false,
    lines: [],
    birthMs: 0,
    mtimeMs: 0,
    size: 0,
  };

  const stat = fileStatMs(path) ?? sudoFileStatMs(path);
  const text = readLogFileText(path);
  if (!stat || text === undefined) {
    return empty;
  }

  const lines = splitLinesWithOffsets(text)
    .map((line) => ({
      text: sanitizeInstallOutput(line.text),
      offset: line.offset,
    }))
    .filter((line) => line.text.trim().length > 0)
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
  const parsed = filtered.map((line) => parseDaemonLogLine(line.text));
  return enrichLineTimestamps(
    parsed,
    meta,
    filtered.map((line) => line.offset),
  );
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
        "turbopanel-daemon is not running — logs appear once the service starts",
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
    keep.push(line);
  }

  return keep;
}

export function readDaemonLogTail(maxLines = 500): DaemonLogLine[] {
  const stdoutBudget = Math.max(1, Math.round(maxLines * 0.8));
  const stderrBudget = Math.max(1, maxLines - stdoutBudget);
  const stdout = tailLinesWithMeta(DAEMON_LOG_PATH, stdoutBudget);
  const stderr = tailLinesWithMeta(DAEMON_ERR_LOG_PATH, stderrBudget);
  const lines = [
    ...parseTailedFile(stdout),
    ...parseTailedFile(stderr),
  ];

  if (lines.length === 0) {
    return emptyLogHints(stdout, stderr);
  }

  return collapseRepeatedStatus(lines.slice(-maxLines));
}

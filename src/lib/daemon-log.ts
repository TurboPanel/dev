import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { DAEMON_LOG_PATH } from "./paths.ts";
import { sanitizeInstallOutput } from "./install-output.ts";

const LOG_PATHS = [DAEMON_LOG_PATH];

/** Legacy stderr noise before structured logging (skip when tailing old err.log). */
function isLegacyNoiseLine(raw: string): boolean {
  const trimmed = raw.trim();
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
    /^\[instance\] waiting/.test(trimmed)
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

function structuredLine(
  time: string,
  level: DaemonLogLevel,
  component: string,
  message: string,
  err?: string,
): DaemonLogLine {
  const resolvedTime = time.trim().length > 0 ? time : new Date().toISOString();
  return {
    time: resolvedTime,
    level,
    component,
    message: waitingMessage(message),
    err,
  };
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
    /\[(?:daemon|instance)\] waiting for instance/.test(trimmed)
  ) {
    return structuredLine("", "info", "instance", "waiting for instance");
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

function tailLines(path: string, maxLines: number): string[] {
  try {
    if (existsSync(path)) {
      const text = readFileSync(path, "utf8");
      return text
        .split("\n")
        .map((line) => sanitizeInstallOutput(line))
        .filter((line) => line.trim().length > 0)
        .slice(-maxLines);
    }
  } catch {
    // Unreadable to the dev user — fall back to sudo tail below.
  }

  const result = spawnSync(
    "sudo",
    ["-n", "tail", "-n", String(maxLines), path],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );

  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  return result.stdout
    .split("\n")
    .map((line) => sanitizeInstallOutput(line))
    .filter((line) => line.trim().length > 0);
}

export function readDaemonLogTail(maxLines = 500): DaemonLogLine[] {
  const rawLines: string[] = [];

  for (const path of LOG_PATHS) {
    rawLines.push(...tailLines(path, maxLines));
  }

  const lines = rawLines.filter((line) => !isLegacyNoiseLine(line));

  if (lines.length === 0) {
    return [
      structuredLine(
        "",
        "warn",
        "console",
        "No daemon logs readable — expected /var/log/turbopanel/daemon/daemon.log",
      ),
      structuredLine(
        "",
        "info",
        "console",
        "Ensure passwordless sudo is enabled for tail, or ask an admin for log access.",
      ),
    ];
  }

  const parsed = lines.map((line) => parseDaemonLogLine(line));
  parsed.sort((a, b) => {
    if (a.time && b.time) {
      return a.time.localeCompare(b.time);
    }
    if (a.time) {
      return -1;
    }
    if (b.time) {
      return 1;
    }
    return 0;
  });
  return collapseConsecutiveLines(parsed.slice(-maxLines));
}

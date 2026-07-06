import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { STRUCTURED_TEXT_WITH_TIME_RE } from "./daemon-log.ts";
import { dockerOutputLines, spawnDocker } from "./docker-access.ts";
import {
  convergeServiceLogPath,
  DAEMON_ERR_LOG_PATH,
  DAEMON_LOG_PATH,
  LOG_DIR,
} from "./paths.ts";
import { shellQuote } from "./shell-quote.ts";

export type ServiceLogLine = {
  text: string;
  time?: string;
};

/** Show only log bytes appended at or after these per-file offsets (post-switch view). */
export type ServiceLogByteFloor = Record<string, number>;

const INSTANCE_LOG_DIR = `${LOG_DIR}/instance`;
const UI_LOG_DIR = `${LOG_DIR}/ui`;
const WEBSITE_LOG_DIR = `${LOG_DIR}/website`;

export const SERVICE_FILE_LOG_PATHS: Record<string, string[]> = {
  instance: [
    `${INSTANCE_LOG_DIR}/instance.err.log`,
    `${INSTANCE_LOG_DIR}/instance.log`,
  ],
  dbstudio: [
    `${INSTANCE_LOG_DIR}/dbstudio.err.log`,
    `${INSTANCE_LOG_DIR}/dbstudio.log`,
  ],
  daemon: [DAEMON_ERR_LOG_PATH, DAEMON_LOG_PATH],
  ui: [
    `${UI_LOG_DIR}/ui.err.log`,
    `${UI_LOG_DIR}/ui.log`,
  ],
  website: [
    `${WEBSITE_LOG_DIR}/website.err.log`,
    `${WEBSITE_LOG_DIR}/website.log`,
  ],
};

const FILE_LOG_SOURCES = SERVICE_FILE_LOG_PATHS;

// Per-line byte budget for tail reads. Service logs (Expo, Caddy, Deno stack
// traces) can be long; 4 KB/line keeps the tail window generous without ever
// loading a multi-hundred-MB log file fully into memory.
const TAIL_BYTES_PER_LINE = 4 * 1024;
const TAIL_MIN_BYTES = 64 * 1024;

const SERVICE_UNITS: Record<string, string> = {
  instance: "turbopanel-instance",
  web: "turbopanel-caddy",
  dbstudio: "turbopanel-dbstudio",
  ui: "turbopanel-ui",
  website: "turbopanel-website",
  cache: "turbopanel-redis",
  queue: "turbopanel-rabbitmq",
  smtp: "turbopanel-mailpit",
};

const DOCKER_LOG_CONTAINERS: Record<string, string> = {
  db: "turbopaneldb",
  smtp: "turbopanelmailpit",
  queue: "turbopanelq",
};

export function serviceSystemdUnit(serviceId: string): string | null {
  return SERVICE_UNITS[serviceId] ?? null;
}

function parseServiceLine(text: string): ServiceLogLine {
  const match = STRUCTURED_TEXT_WITH_TIME_RE.exec(text);
  if (match) {
    const time = match[1];
    return { text: text.slice(time.length).trimStart(), time };
  }
  return { text };
}

/**
 * Read only the final bytes of a file (enough to cover `maxLines`) instead of
 * loading the whole file. Append-only log files can grow to hundreds of MB; a
 * full `readFileSync` on every 1s poll exhausts the heap. When the read starts
 * mid-file, the first (partial) line is dropped.
 */
function fileSize(path: string): number | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    return fstatSync(fd).size;
  } catch {
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

export function readServiceLogFileStat(serviceId: string): ServiceLogByteFloor {
  const paths = SERVICE_FILE_LOG_PATHS[serviceId] ?? [];
  const floor: ServiceLogByteFloor = {};
  for (const path of paths) {
    const size = fileSize(path);
    if (size !== undefined) {
      floor[path] = size;
    }
  }
  return floor;
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

function tailFile(
  path: string,
  maxLines: number,
  minByteOffset = 0,
): string[] {
  if (!existsSync(path)) {
    return [];
  }
  const text = readFileTailText(path, maxLines, minByteOffset);
  if (text === undefined) {
    return [];
  }
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(-maxLines);
}

function tailJournal(unit: string, maxLines: number): string[] {
  const journalArgs = [
    "journalctl",
    "-u",
    unit,
    "-n",
    String(maxLines),
    "--no-pager",
    "-q",
    "-o",
    "cat",
  ];
  const journalCmd = journalArgs.map(shellQuote).join(" ");

  const attempts: string[][] = [
    ["sudo", "-n", "bash", "-c", journalCmd],
    ["sudo", "-n", ...journalArgs],
    journalArgs,
  ];

  for (const cmd of attempts) {
    const result = spawnSync(cmd[0]!, cmd.slice(1), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status === 0) {
      return (result.stdout ?? "")
        .split("\n")
        .filter((line) => line.trim().length > 0);
    }
  }

  return [];
}

function tailDockerLogs(container: string, maxLines: number): string[] {
  const result = spawnDocker(["logs", "--tail", String(maxLines), container]);
  if (!result) {
    return [];
  }
  return dockerOutputLines(result);
}

export function readServiceLogTail(
  serviceId: string,
  maxLines = 500,
  byteFloor?: ServiceLogByteFloor | null,
): ServiceLogLine[] {
  const dockerContainer = DOCKER_LOG_CONTAINERS[serviceId];
  const unit = dockerContainer ? null : serviceSystemdUnit(serviceId);
  const filePaths = FILE_LOG_SOURCES[serviceId] ?? [];
  const collected: string[] = [];

  collected.push(...tailFile(convergeServiceLogPath(serviceId), maxLines));

  for (const path of filePaths) {
    collected.push(...tailFile(path, maxLines, byteFloor?.[path] ?? 0));
  }

  if (dockerContainer) {
    collected.push(...tailDockerLogs(dockerContainer, maxLines));
  } else if (unit && collected.length === 0) {
    collected.push(...tailJournal(unit, maxLines));
  }

  if (collected.length === 0) {
    let hint: string;
    if (dockerContainer) {
      hint = `No logs yet — docker logs ${dockerContainer}`;
    } else if (unit) {
      hint = `No logs yet — journalctl -u ${unit} (sudo may be required)`;
    } else {
      hint = "No logs available for this service";
    }
    return [parseServiceLine(hint)];
  }

  return collected.slice(-maxLines).map(parseServiceLine);
}

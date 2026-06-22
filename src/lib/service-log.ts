import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { STRUCTURED_TEXT_WITH_TIME_RE } from "./daemon-log.ts";
import { dockerOutputLines, spawnDocker } from "./docker-access.ts";
import {
  convergeServiceLogPath,
  DAEMON_ERR_LOG_PATH,
  DAEMON_LOG_PATH,
  platformRepoPath,
} from "./paths.ts";

export type ServiceLogLine = {
  text: string;
  time?: string;
};

const INSTANCE_LOG_DIR = `${platformRepoPath("instance")}/logs`;
const UI_LOG_DIR = `${platformRepoPath("ui")}/logs`;
const WEBSITE_LOG_DIR = `${platformRepoPath("website")}/logs`;

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
  ui: [`${UI_LOG_DIR}/ui.err.log`, `${UI_LOG_DIR}/ui.log`],
  website: [
    `${WEBSITE_LOG_DIR}/website.err.log`,
    `${WEBSITE_LOG_DIR}/website.log`,
  ],
};

const FILE_LOG_SOURCES = SERVICE_FILE_LOG_PATHS;

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

function tailFile(path: string, maxLines: number): string[] {
  try {
    if (!existsSync(path)) {
      return [];
    }
    const text = readFileSync(path, "utf8");
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .slice(-maxLines);
  } catch {
    return [];
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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
): ServiceLogLine[] {
  const dockerContainer = DOCKER_LOG_CONTAINERS[serviceId];
  const unit = dockerContainer ? null : serviceSystemdUnit(serviceId);
  const filePaths = FILE_LOG_SOURCES[serviceId] ?? [];
  const collected: string[] = [];

  collected.push(...tailFile(convergeServiceLogPath(serviceId), maxLines));

  for (const path of filePaths) {
    collected.push(...tailFile(path, maxLines));
  }

  if (dockerContainer) {
    collected.push(...tailDockerLogs(dockerContainer, maxLines));
  } else if (unit && collected.length === 0) {
    collected.push(...tailJournal(unit, maxLines));
  }

  if (collected.length === 0) {
    const hint = dockerContainer
      ? `No logs yet — docker logs ${dockerContainer}`
      : unit
      ? `No logs yet — journalctl -u ${unit} (sudo may be required)`
      : "No logs available for this service";
    return [parseServiceLine(hint)];
  }

  return collected.slice(-maxLines).map(parseServiceLine);
}

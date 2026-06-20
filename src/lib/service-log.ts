import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { STRUCTURED_TEXT_WITH_TIME_RE } from "./daemon-log.ts";
import {
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

const FILE_LOG_SOURCES: Record<string, string[]> = {
  instance: [
    `${INSTANCE_LOG_DIR}/instance.err.log`,
    `${INSTANCE_LOG_DIR}/instance.log`,
  ],
  daemon: [DAEMON_ERR_LOG_PATH, DAEMON_LOG_PATH],
  ui: [`${UI_LOG_DIR}/ui.err.log`, `${UI_LOG_DIR}/ui.log`],
};

const SERVICE_UNITS: Record<string, string> = {
  instance: "turbopanel-instance",
  ui: "turbopanel-ui",
  website: "turbopanel-website",
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

export function readServiceLogTail(
  serviceId: string,
  maxLines = 500,
): ServiceLogLine[] {
  const unit = serviceSystemdUnit(serviceId);
  const collected: string[] = [];

  for (const path of FILE_LOG_SOURCES[serviceId] ?? []) {
    collected.push(...tailFile(path, maxLines));
  }

  if (unit) {
    collected.push(...tailJournal(unit, maxLines));
  }

  if (collected.length === 0) {
    const hint = unit
      ? `No logs yet — journalctl -u ${unit} (sudo may be required)`
      : "No logs available for this service";
    return [parseServiceLine(hint)];
  }

  return collected.slice(-maxLines).map(parseServiceLine);
}

import { existsSync, statSync } from "node:fs";
import { serviceDisplayName } from "../dev-services.ts";
import { convergeServiceLogPath } from "./paths.ts";
import {
  SERVICE_FILE_LOG_PATHS,
  serviceDockerLogContainer,
  serviceSystemdUnit,
} from "./service-log.ts";
import { shellQuote } from "./shell-quote.ts";
import { spawnSyncTrusted, spawnSyncTrustedText } from "./spawn-trusted.ts";

/** Lines of history for docker/journal (and multi-file `tail` merges). */
export const EXTERNAL_LOG_TAIL_LINES = 1_000;

export type ServiceLogPagerCommand = {
  command: string;
  args: string[];
  /** Short summary for the pre-pager banner title line. */
  summary: string;
  /** Keybinding lines printed before the pager starts. */
  keys: string[];
};

/** Injectable checks for unit tests. */
export type ServiceLogPagerDeps = {
  pathExists?: (path: string) => boolean;
  pathSize?: (path: string) => number;
  hasCommand?: (name: string) => boolean;
  dockerInvoker?: () => string[];
  journalInvoker?: () => string[];
};

/** Modern less (with poll) interrupts +F follow with Ctrl+X, not Ctrl+C. */
const LESS_FOLLOW_KEYS = [
  "Ctrl+X  stop live follow, then scroll / copy",
  "F       resume live follow",
  "q       return to console",
];

const LESS_MULTI_FILE_KEYS = [
  ...LESS_FOLLOW_KEYS,
  ":n/:p   next / previous log file",
];

const TAIL_KEYS = ["Ctrl+C  return to console"];

function commandOnPath(name: string): boolean {
  const result = spawnSyncTrustedText("sh", ["-c", `command -v ${shellQuote(name)}`], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 && (result.stdout?.trim().length ?? 0) > 0;
}

function defaultDockerInvoker(): string[] {
  const direct = spawnSyncTrusted(
    "docker",
    ["version", "-f", "{{.Server.Version}}"],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  if (direct.status === 0) {
    return ["docker"];
  }
  const elevated = spawnSyncTrusted(
    "sudo",
    ["-n", "docker", "version", "-f", "{{.Server.Version}}"],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  if (elevated.status === 0) {
    return ["sudo", "-n", "docker"];
  }
  return ["docker"];
}

function defaultJournalInvoker(): string[] {
  // Match in-TUI journal tails: prefer passwordless sudo when available.
  const elevated = spawnSyncTrusted("sudo", ["-n", "true"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (elevated.status === 0) {
    return ["sudo", "-n", "journalctl"];
  }
  return ["journalctl"];
}

function defaultPathSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function usablePaths(
  paths: string[],
  pathExists: (path: string) => boolean,
  pathSize: (path: string) => number,
): string[] {
  const existing = paths.filter((path) => pathExists(path));
  const nonEmpty = existing.filter((path) => pathSize(path) > 0);
  // Prefer non-empty files so less does not open on a short converge stub.
  return nonEmpty.length > 0 ? nonEmpty : existing;
}

function fileLogPaths(
  serviceId: string,
  pathExists: (path: string) => boolean,
  pathSize: (path: string) => number,
): string[] {
  const converge = convergeServiceLogPath(serviceId);
  const mapped = SERVICE_FILE_LOG_PATHS[serviceId] ?? [];
  // Prefer the main `.log` over `.err.log`; keep converge last (install noise).
  const ordered = [...mapped].reverse();
  return usablePaths([...ordered, converge], pathExists, pathSize);
}

function lessFollowCommand(paths: string[]): ServiceLogPagerCommand {
  const multi = paths.length > 1;
  return {
    command: "less",
    args: ["-R", "--follow-name", "+F", "--", ...paths],
    summary: multi
      ? `less follow (${paths.length} files)`
      : "less follow",
    keys: multi ? LESS_MULTI_FILE_KEYS : LESS_FOLLOW_KEYS,
  };
}

function shellPipeline(source: string): ServiceLogPagerCommand {
  return {
    command: "sh",
    args: ["-c", `${source} | less -R +F`],
    summary: "less follow",
    keys: LESS_FOLLOW_KEYS,
  };
}

function dockerPagerCommand(
  container: string,
  lines: number,
  deps: Required<Pick<ServiceLogPagerDeps, "hasCommand" | "dockerInvoker">>,
): ServiceLogPagerCommand {
  const invoker = deps.dockerInvoker();
  const invokerCmd = invoker.map(shellQuote).join(" ");
  const logsArgs =
    `logs -f --tail ${shellQuote(String(lines))} ${shellQuote(container)}`;

  if (deps.hasCommand("less")) {
    return shellPipeline(`${invokerCmd} ${logsArgs} 2>&1`);
  }
  return {
    command: invoker[0]!,
    args: [...invoker.slice(1), "logs", "-f", "--tail", String(lines), container],
    summary: "docker logs -f",
    keys: TAIL_KEYS,
  };
}

function journalPagerCommand(
  unit: string,
  lines: number,
  deps: Required<Pick<ServiceLogPagerDeps, "hasCommand" | "journalInvoker">>,
): ServiceLogPagerCommand {
  const invoker = deps.journalInvoker();
  const invokerCmd = invoker.map(shellQuote).join(" ");
  const journalArgs =
    `-u ${shellQuote(unit)} -n ${shellQuote(String(lines))} -f -o cat`;

  if (deps.hasCommand("less")) {
    return shellPipeline(`${invokerCmd} ${journalArgs} 2>&1`);
  }
  return {
    command: invoker[0]!,
    args: [...invoker.slice(1), "-u", unit, "-n", String(lines), "-f", "-o", "cat"],
    summary: "journalctl -f",
    keys: TAIL_KEYS,
  };
}

/**
 * Resolve an interactive external pager/tailer for a service log.
 * Prefer file logs via `less +F`, then docker logs, then journalctl.
 */
export function resolveServiceLogPager(
  serviceId: string,
  lines: number = EXTERNAL_LOG_TAIL_LINES,
  deps: ServiceLogPagerDeps = {},
): ServiceLogPagerCommand | null {
  const pathExists = deps.pathExists ?? existsSync;
  const pathSize = deps.pathSize ?? defaultPathSize;
  const hasCommand = deps.hasCommand ?? commandOnPath;
  const dockerInvoker = deps.dockerInvoker ?? defaultDockerInvoker;
  const journalInvoker = deps.journalInvoker ?? defaultJournalInvoker;

  const files = fileLogPaths(serviceId, pathExists, pathSize);
  if (files.length > 0 && hasCommand("less")) {
    return lessFollowCommand(files);
  }
  if (files.length > 0) {
    return {
      command: "tail",
      args: ["-n", String(lines), "-F", ...files],
      summary: "tail -F",
      keys: TAIL_KEYS,
    };
  }

  const container = serviceDockerLogContainer(serviceId);
  if (container) {
    return dockerPagerCommand(container, lines, { hasCommand, dockerInvoker });
  }

  const unit = serviceSystemdUnit(serviceId);
  if (unit) {
    return journalPagerCommand(unit, lines, { hasCommand, journalInvoker });
  }

  return null;
}

function waitForEnter(): void {
  process.stdout.write("Press Enter to return to the console…");
  spawnSyncTrusted("sh", ["-c", "read -r _ </dev/tty"], {
    stdio: "inherit",
  });
}

function writePagerBanner(displayName: string, pager: ServiceLogPagerCommand): void {
  process.stdout.write(`${displayName} logs — ${pager.summary}\n`);
  for (const line of pager.keys) {
    process.stdout.write(`  ${line}\n`);
  }
  process.stdout.write("\n");
}

function runCommand(command: string, args: string[]): number {
  // Ctrl+C in the pager must not SIGINT the Node/Ink parent (that dumps you
  // out of the console entirely). less itself uses Ctrl+X to leave +F mode.
  const previousSIGINT = process.listeners("SIGINT").slice();
  process.removeAllListeners("SIGINT");
  const ignoreSigint = (): void => {
    // swallow — foreground less/tail owns the TTY
  };
  process.on("SIGINT", ignoreSigint);

  try {
    const result = spawnSyncTrusted(command, args, {
      stdio: "inherit",
    });
    if (result.error) {
      return 1;
    }
    // less exits 0 on q; SIGINT from a bare tail/docker may be non-zero — treat
    // both as a normal return to the TUI.
    if (result.status === 0 || result.signal === "SIGINT") {
      return 0;
    }
    return result.status ?? 1;
  } finally {
    process.off("SIGINT", ignoreSigint);
    for (const listener of previousSIGINT) {
      process.on("SIGINT", listener as (signal: NodeJS.Signals) => void);
    }
  }
}

/**
 * Hand the TTY to an external log pager for `serviceId`.
 * Call from inside Ink's `suspendTerminal()` so the alternate screen is restored.
 */
export function openServiceLogPager(
  serviceId: string,
  lines: number = EXTERNAL_LOG_TAIL_LINES,
): void {
  const displayName = serviceDisplayName(serviceId);
  const pager = resolveServiceLogPager(serviceId, lines);

  process.stdout.write("\n");
  if (!pager) {
    process.stdout.write(`No logs available for ${displayName}.\n`);
    waitForEnter();
    return;
  }

  writePagerBanner(displayName, pager);
  const status = runCommand(pager.command, pager.args);
  if (status !== 0) {
    process.stdout.write(`\nLog viewer exited with status ${status}.\n`);
    waitForEnter();
  }
}

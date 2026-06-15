import { fetchStackStatus } from "@turbopanel/stack-status";

const LOG_SOURCES: Array<{ unit: string; path: string }> = [
  { unit: "instance", path: "/var/log/turbopanel/instance/instance.err.log" },
  { unit: "instance", path: "/var/log/turbopanel/instance/instance.log" },
  { unit: "daemon", path: "/var/log/turbopanel/daemon/daemon.err.log" },
  { unit: "daemon", path: "/var/log/turbopanel/daemon/daemon.log" },
];

async function tailFile(path: string, maxLines: number): Promise<string[]> {
  try {
    const text = await Deno.readTextFile(path);
    const lines = text.split("\n").filter((line) => line.trim().length > 0);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

function systemctlShow(property: string, unit: string): string {
  const proc = new Deno.Command("systemctl", {
    args: ["show", unit, `-p${property}`, "--value"],
    stdout: "piped",
    stderr: "null",
  }).outputSync();
  if (!proc.success) return "";
  return new TextDecoder().decode(proc.stdout).trim();
}

export type StackLogLine = {
  source: string;
  text: string;
};

export async function fetchStackLogLines(maxLines = 18): Promise<{
  lines: StackLogLine[];
  header: string;
}> {
  const instanceRestarts = systemctlShow("NRestarts", "turbopanel-instance");
  const instanceState = systemctlShow("ActiveState", "turbopanel-instance");
  const stack = fetchStackStatus();
  const activeCount = stack.filter((unit) => unit.active === true).length;
  const header = `instance ${instanceState} · restarts ${instanceRestarts} · ${activeCount}/${stack.length} units active`;

  const collected: StackLogLine[] = [];
  for (const source of LOG_SOURCES) {
    const fileLines = await tailFile(source.path, maxLines);
    for (const text of fileLines) {
      collected.push({ source: source.unit, text });
    }
  }

  if (collected.length === 0) {
    const journalProc = await new Deno.Command("journalctl", {
      args: [
        "-n",
        String(maxLines),
        "--no-pager",
        "--output=short-iso",
        "-u",
        "turbopanel-instance",
        "-u",
        "turbopanel-daemon",
      ],
      stdout: "piped",
      stderr: "null",
    }).output();
    if (journalProc.success) {
      const journalText = new TextDecoder().decode(journalProc.stdout).trim();
      if (journalText) {
        for (const text of journalText.split("\n")) {
          collected.push({ source: "journal", text });
        }
      }
    }
  }

  if (collected.length === 0) {
    return {
      header,
      lines: [{
        source: "hint",
        text: "No log files yet — run instance converge to install /var/log/turbopanel/instance/*.log",
      }],
    };
  }

  return {
    header,
    lines: collected.slice(-maxLines),
  };
}

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

export async function fetchStackLogLines(maxLines = 8): Promise<{
  lines: StackLogLine[];
  header: string;
}> {
  const instanceRestarts = systemctlShow("NRestarts", "turbopanel-instance");
  const instanceState = systemctlShow("ActiveState", "turbopanel-instance");
  const header = `inst ${instanceState} · restarts ${instanceRestarts}`;

  const collected: StackLogLine[] = [];
  for (const source of LOG_SOURCES) {
    const fileLines = await tailFile(source.path, maxLines);
    for (const text of fileLines) {
      collected.push({ source: source.unit, text });
    }
  }

  if (collected.length === 0) {
    return {
      header,
      lines: [{
        source: "hint",
        text: "No log files at /var/log/turbopanel/{instance,daemon}/*.log yet",
      }],
    };
  }

  return {
    header,
    lines: collected.slice(-maxLines),
  };
}

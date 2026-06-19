const FILE_LOG_SOURCES: Array<{ unit: string; path: string }> = [
  { unit: "instance", path: "/var/log/turbopanel/instance/instance.err.log" },
  { unit: "instance", path: "/var/log/turbopanel/instance/instance.log" },
  { unit: "daemon", path: "/var/log/turbopanel/daemon/daemon.err.log" },
  { unit: "daemon", path: "/var/log/turbopanel/daemon/daemon.log" },
];

const JOURNAL_UNITS = [
  "turbopanel-ui",
  "turbopanel-website",
  "turbopanel-caddy",
] as const;

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

async function tailJournal(unit: string, maxLines: number): Promise<string[]> {
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

  const quietSudo = new Deno.Command("sudo", {
    args: ["-n", ...journalArgs],
    stdout: "piped",
    stderr: "null",
  });
  let output = await quietSudo.output();
  if (!output.success) {
    output = await new Deno.Command("journalctl", {
      args: journalArgs.slice(1),
      stdout: "piped",
      stderr: "null",
    }).output();
  }
  if (!output.success) {
    return [];
  }
  const text = new TextDecoder().decode(output.stdout);
  return text.split("\n").filter((line) => line.trim().length > 0);
}

function unitHeader(unit: string): string {
  const state = systemctlShow("ActiveState", unit);
  const sub = systemctlShow("SubState", unit);
  const restarts = systemctlShow("NRestarts", unit);
  const result = systemctlShow("Result", unit);
  const parts = [unit, state];
  if (sub && sub !== state) parts.push(sub);
  if (restarts && restarts !== "0") parts.push(`restarts=${restarts}`);
  if (result && result !== "success") parts.push(`result=${result}`);
  return parts.join(" · ");
}

export type StackLogLine = {
  source: string;
  text: string;
};

export async function fetchStackLogLines(maxLines = 8): Promise<{
  lines: StackLogLine[];
  header: string;
}> {
  const headerParts = [
    unitHeader("turbopanel-instance"),
    unitHeader("turbopanel-ui"),
    unitHeader("turbopanel-website"),
  ];
  const header = headerParts.join(" │ ");

  const collected: StackLogLine[] = [];

  for (const source of FILE_LOG_SOURCES) {
    const fileLines = await tailFile(source.path, maxLines);
    for (const text of fileLines) {
      collected.push({ source: source.unit, text });
    }
  }

  for (const unit of JOURNAL_UNITS) {
    const journalLines = await tailJournal(unit, maxLines);
    for (const text of journalLines) {
      collected.push({ source: unit.replace("turbopanel-", ""), text });
    }
  }

  if (collected.length === 0) {
    return {
      header,
      lines: [{
        source: "hint",
        text: "No logs yet — files under /var/log/turbopanel/ or journalctl -u turbopanel-*",
      }],
    };
  }

  return {
    header,
    lines: collected.slice(-maxLines),
  };
}

import { CONSOLE_LAST_TASK_ERROR_LOG } from "@turbopanel/lib/paths.ts";

export type TaskErrorRecord = {
  title: string;
  message: string;
  recap?: string | null;
  tasks?: Array<{ label: string; status: string }>;
  timestamp: string;
};

export async function writeTaskErrorLog(record: TaskErrorRecord): Promise<void> {
  const lines = [
    `time=${record.timestamp}`,
    `title=${record.title}`,
    "",
    record.message,
    "",
  ];
  if (record.recap) {
    lines.push(record.recap, "");
  }
  if (record.tasks && record.tasks.length > 0) {
    lines.push("tasks:");
    for (const task of record.tasks) {
      lines.push(`  [${task.status}] ${task.label}`);
    }
    lines.push("");
  }
  lines.push(`log=${CONSOLE_LAST_TASK_ERROR_LOG}`);

  const body = lines.join("\n");
  try {
    await Deno.mkdir(CONSOLE_LAST_TASK_ERROR_LOG.replace(/\/[^/]+$/, ""), {
      recursive: true,
    });
    await Deno.writeTextFile(CONSOLE_LAST_TASK_ERROR_LOG, body);
    return;
  } catch {
    // Checkout may be turbopanel-owned; fall back to sudo.
  }

  const proc = new Deno.Command("sudo", {
    args: [
      "bash",
      "-c",
      `mkdir -p "$(dirname '${CONSOLE_LAST_TASK_ERROR_LOG}')" && cat > '${CONSOLE_LAST_TASK_ERROR_LOG}'`,
    ],
    stdin: "piped",
    stdout: "null",
    stderr: "null",
  }).spawn();
  const writer = proc.stdin.getWriter();
  await writer.write(new TextEncoder().encode(body));
  await writer.close();
  await proc.status;
}

import fs from "node:fs/promises";
import { CONSOLE_LAST_TASK_ERROR_LOG } from "./paths.ts";
import { spawnSyncTrusted } from "./spawn-trusted.ts";

export type TaskErrorRecord = {
  title: string;
  message: string;
  recap?: string | null;
  tasks?: Array<{ label: string; status: string }>;
  timestamp: string;
};

function writeWithSudo(body: string): boolean {
  const result = spawnSyncTrusted(
    "/usr/bin/sudo",
    [
      "-n",
      "/usr/bin/bash",
      "-c",
      `mkdir -p "$(dirname '${CONSOLE_LAST_TASK_ERROR_LOG}')" && cat > '${CONSOLE_LAST_TASK_ERROR_LOG}'`,
    ],
    {
      input: body,
      stdio: ["pipe", "ignore", "ignore"],
    },
  );
  return result.status === 0;
}

export async function writeTaskErrorLog(
  record: TaskErrorRecord,
): Promise<boolean> {
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
    await fs.mkdir(CONSOLE_LAST_TASK_ERROR_LOG.replace(/\/[^/]+$/, ""), {
      recursive: true,
    });
    await fs.writeFile(CONSOLE_LAST_TASK_ERROR_LOG, body, "utf8");
    return true;
  } catch {
    // Checkout may be turbopanel-owned; fall back to sudo.
  }

  return writeWithSudo(body);
}

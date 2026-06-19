import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { CONSOLE_LAST_TASK_ERROR_LOG } from "./paths.ts";

export type TaskErrorRecord = {
  title: string;
  message: string;
  recap?: string | null;
  tasks?: Array<{ label: string; status: string }>;
  timestamp: string;
};

function writeWithSudo(body: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(
      "sudo",
      [
        "bash",
        "-c",
        `mkdir -p "$(dirname '${CONSOLE_LAST_TASK_ERROR_LOG}')" && cat > '${CONSOLE_LAST_TASK_ERROR_LOG}'`,
      ],
      { stdio: ["pipe", "ignore", "ignore"] },
    );

    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));

    const stdin = proc.stdin;
    if (!stdin) {
      resolve(false);
      return;
    }

    stdin.write(body, "utf8", (err) => {
      if (err) {
        proc.kill();
        resolve(false);
        return;
      }
      stdin.end();
    });
  });
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

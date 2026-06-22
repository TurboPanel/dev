import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { convergeServiceLogPath } from "./paths.ts";

/** Append a converge-status line to the console converge log (best-effort). */
export function appendConvergeServiceLogLine(
  serviceId: string,
  text: string,
  time = new Date().toISOString(),
): void {
  const logPath = convergeServiceLogPath(serviceId);

  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${time} ${text}\n`, "utf8");
  } catch {
    // Converge UI still works when log writes fail.
  }
}

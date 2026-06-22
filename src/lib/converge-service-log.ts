import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SERVICE_FILE_LOG_PATHS } from "./service-log.ts";

function convergeLogPath(serviceId: string): string | null {
  const paths = SERVICE_FILE_LOG_PATHS[serviceId];
  if (!paths?.length) {
    return null;
  }
  return (
    paths.find((path) => path.endsWith(".log") && !path.includes(".err.")) ??
    paths.at(-1) ??
    null
  );
}

/** Append a converge-status line to the service log file (best-effort). */
export function appendConvergeServiceLogLine(
  serviceId: string,
  text: string,
  time = new Date().toISOString(),
): void {
  const logPath = convergeLogPath(serviceId);
  if (!logPath) {
    return;
  }

  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${time} ${text}\n`, "utf8");
  } catch {
    // Log dirs may not exist yet for some services; converge UI still works.
  }
}

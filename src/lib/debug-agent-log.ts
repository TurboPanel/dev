import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const DEBUG_ENDPOINT =
  "http://localhost:7440/ingest/3e0179a5-fa63-49e5-b717-b62ee1a155c9";
const DEBUG_LOG_PATH = "/home/dev/turbopanel-dev/.cursor/debug-2655b2.log";
const DEBUG_SESSION = "2655b2";

export function agentDebugLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
  runId = "pre-fix",
): void {
  const payload = {
    sessionId: DEBUG_SESSION,
    location,
    message,
    data,
    timestamp: Date.now(),
    hypothesisId,
    runId,
  };
  // #region agent log
  try {
    appendFileSync(DEBUG_LOG_PATH, `${JSON.stringify(payload)}\n`);
  } catch {
    // ignore
  }
  fetch(DEBUG_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": DEBUG_SESSION,
    },
    body: JSON.stringify(payload),
  }).catch(() => {});
  // #endregion
}

export function probeCacheOwnership(): string {
  const result = spawnSync(
    "sudo",
    ["-n", "stat", "-c", "%U:%G %a", "/opt/turbopanel/.cache/deno"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  if (result.status !== 0 || !result.stdout?.trim()) {
    return "unreadable";
  }
  return result.stdout.trim();
}

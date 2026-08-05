/**
 * Recognize the JSONL skip signal from `run-orchestration-action.ts`
 * (`instance-dev-install --if-needed`) when the converge stamp is unchanged.
 */
export function parseDevConvergeSkippedEvent(event: unknown): string | null {
  if (typeof event !== "object" || event === null) {
    return null;
  }
  const record = event as Record<string, unknown>;
  if (record._event !== "dev_converge_skipped") {
    return null;
  }
  return typeof record.reason === "string" ? record.reason : null;
}

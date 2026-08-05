import { describe, expect, it } from "vitest";
import { parseDevConvergeSkippedEvent } from "./dev-converge-skip-event.ts";

describe("parseDevConvergeSkippedEvent", () => {
  it("returns the reason for a well-formed skip event", () => {
    expect(
      parseDevConvergeSkippedEvent({
        _event: "dev_converge_skipped",
        reason: "dev converge stamp matches (orchestration inputs unchanged)",
      }),
    ).toBe("dev converge stamp matches (orchestration inputs unchanged)");
  });

  it("returns null for other _event values", () => {
    expect(
      parseDevConvergeSkippedEvent({
        _event: "v2_playbook_on_stats",
        reason: "ok=1",
      }),
    ).toBeNull();
  });

  it("returns null for malformed or non-object input", () => {
    expect(parseDevConvergeSkippedEvent(null)).toBeNull();
    expect(parseDevConvergeSkippedEvent("dev_converge_skipped")).toBeNull();
    expect(parseDevConvergeSkippedEvent(42)).toBeNull();

    const malformed: unknown = {
      _event: "dev_converge_skipped",
      reason: 7,
    };
    if (
      typeof malformed !== "object" ||
      malformed === null ||
      typeof (malformed as { reason?: unknown }).reason === "string"
    ) {
      throw new TypeError("expected non-string reason on malformed skip payload");
    }
    expect(parseDevConvergeSkippedEvent(malformed)).toBeNull();
  });
});

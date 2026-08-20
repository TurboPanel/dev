import { describe, expect, it } from "vitest";
import { parseAnsibleJsonlRecord } from "./ansible-jsonl.ts";

describe("parseAnsibleJsonlRecord", () => {
  it("returns the record and event name for a JSONL callback object", () => {
    const event = { _event: "v2_playbook_on_stats", stats: {} };
    expect(parseAnsibleJsonlRecord(event)).toEqual({
      record: event,
      eventType: "v2_playbook_on_stats",
    });
  });

  it("returns null for non-objects and missing event names", () => {
    expect(parseAnsibleJsonlRecord(null)).toBeNull();
    expect(parseAnsibleJsonlRecord("v2_runner_on_ok")).toBeNull();
    expect(parseAnsibleJsonlRecord({ play: { name: "db" } })).toBeNull();
    expect(parseAnsibleJsonlRecord({ _event: 12 })).toBeNull();
  });
});

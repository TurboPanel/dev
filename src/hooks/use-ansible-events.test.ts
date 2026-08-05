import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDevConvergeSkippedUi } from "./use-ansible-events.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("resolveDevConvergeSkippedUi", () => {
  it("sets recap and done immediately for a skip event", () => {
    const reason = "dev converge stamp matches (orchestration inputs unchanged)";
    expect(
      resolveDevConvergeSkippedUi({
        _event: "dev_converge_skipped",
        reason,
      }),
    ).toEqual({
      recap: `Development environment already converged — ${reason}`,
      done: true,
    });
  });

  it("returns null for ordinary Ansible stats so the hook keeps processing", () => {
    expect(
      resolveDevConvergeSkippedUi({
        _event: "v2_playbook_on_stats",
        stats: { localhost: { ok: 1, changed: 0, failures: 0 } },
      }),
    ).toBeNull();
  });

  it("returns null for malformed skip payloads", () => {
    expect(resolveDevConvergeSkippedUi(null)).toBeNull();
    expect(
      resolveDevConvergeSkippedUi({
        _event: "dev_converge_skipped",
        reason: 12,
      }),
    ).toBeNull();
  });
});

describe("useAnsibleEvents skip wiring", () => {
  it("applies skipped UI state via resolveDevConvergeSkippedUi then returns", () => {
    const source = readFileSync(join(HERE, "use-ansible-events.ts"), "utf8");
    const onEventStart = source.indexOf("const onEvent = useCallback");
    expect(onEventStart).toBeGreaterThanOrEqual(0);
    const body = source.slice(onEventStart);
    const resolveCall = body.indexOf("resolveDevConvergeSkippedUi(event)");
    const setRecap = body.indexOf("setRecap(skipped.recap)");
    const setDone = body.indexOf("setDone(skipped.done)");
    const earlyReturn = body.indexOf("return;", setDone);
    expect(resolveCall).toBeGreaterThanOrEqual(0);
    expect(setRecap).toBeGreaterThan(resolveCall);
    expect(setDone).toBeGreaterThan(setRecap);
    expect(earlyReturn).toBeGreaterThan(setDone);
  });
});

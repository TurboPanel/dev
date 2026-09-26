import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { siblingCheckout } from "./sibling-checkout.ts";

describe("siblingCheckout", () => {
  let base: string | undefined;
  afterEach(() => {
    if (base) rmSync(base, { recursive: true, force: true });
    base = undefined;
  });

  it("finds a sibling under TURBOPANEL_SIBLINGS_DIR", () => {
    base = mkdtempSync(join(tmpdir(), "tp-siblings-"));
    mkdirSync(join(base, "turbopaneld"));
    expect(siblingCheckout("turbopaneld", { TURBOPANEL_SIBLINGS_DIR: base }))
      .toBe(join(base, "turbopaneld"));
  });

  it("returns null for a missing sibling when not required", () => {
    base = mkdtempSync(join(tmpdir(), "tp-siblings-"));
    expect(siblingCheckout("ui", { TURBOPANEL_SIBLINGS_DIR: base })).toBeNull();
  });

  it("throws for a missing sibling when CI requires siblings", () => {
    base = mkdtempSync(join(tmpdir(), "tp-siblings-"));
    expect(() =>
      siblingCheckout("website", {
        TURBOPANEL_SIBLINGS_DIR: base,
        TURBOPANEL_REQUIRE_SIBLINGS: "1",
      })
    ).toThrow(/required but missing/);
  });
});

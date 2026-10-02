import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type SiblingRepo, siblingCheckout } from "./sibling-checkout.ts";

const DEV_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SIBLINGS: SiblingRepo[] = ["turbopanel", "turbopaneld", "ui", "website"];
const SHARED_FILES = [
  "scripts/scan-secrets.sh",
  "scripts/scan-secrets.patterns",
  "scripts/scan-secrets.selftest.sh",
];

// The same scanner, rules and self-test ship in all five repos. CI checks the
// siblings out beside this repo and requires them (TURBOPANEL_REQUIRE_SIBLINGS),
// so a drifted copy fails here rather than leaving one repo with weaker rules.
describe("the secret scanner is byte-identical in every repo", () => {
  for (const file of SHARED_FILES) {
    const own = readFileSync(join(DEV_ROOT, file), "utf8");
    for (const name of SIBLINGS) {
      const dir = siblingCheckout(name);
      it.skipIf(dir === null)(`${name} carries the same ${file}`, () => {
        expect(readFileSync(join(dir!, file), "utf8")).toBe(own);
      });
    }
  }
});

// The self-test builds its fixtures at run time from fragments, proves each
// rule fires and ordinary code stays clean, and covers the allowlist and the
// commit range scan. See scripts/scan-secrets.selftest.sh.
describe("scan-secrets self-test", () => {
  it("passes", () => {
    const res = spawnSync("sh", ["scripts/scan-secrets.selftest.sh"], {
      cwd: DEV_ROOT,
      encoding: "utf8",
    });
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("checks passed");
  }, 120_000);
});

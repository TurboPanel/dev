import { expect, test } from "vitest";
import { proofLabel } from "./zz-sonar-proof";

test("proofLabel", () => {
  expect(proofLabel(1)).toBe("positive");
  expect(proofLabel(-1)).toBe("negative");
  expect(proofLabel(0)).toBe("zero");
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(file: string): string {
  return readFileSync(join(ROOT, file), "utf8");
}

describe("version literals", () => {
  test("package.json and sonar.projectVersion carry the same semver", () => {
    const pkg = JSON.parse(read("package.json")) as { version: string };
    const sonar = /^sonar\.projectVersion=(.+)$/m
      .exec(read("sonar-project.properties"))?.[1]
      ?.trim();
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    expect(sonar).toBe(pkg.version);
  });
});

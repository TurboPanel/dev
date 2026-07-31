import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { mergeEnvFile, parseEnvEntries } from "./env-file.ts";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "turbopanel-env-file-"));
  return tempDir;
}

test("parseEnvEntries parses keys and ignores non-matching lines", () => {
  const content = [
    "# comment",
    "",
    "FOO=bar",
    "lowercase=ignored",
    "BAZ=value=with=equals",
    "FOO=later",
  ].join("\n");

  const entries = parseEnvEntries(content);
  expect(entries.get("FOO")).toBe("later");
  expect(entries.get("BAZ")).toBe("value=with=equals");
  expect(entries.has("lowercase")).toBe(false);
  expect(entries.size).toBe(2);
});

test("mergeEnvFile updates managed keys in place and appends new ones", () => {
  const dir = makeTempDir();
  const path = join(dir, "daemon.env");
  writeFileSync(
    path,
    [
      "# header",
      "",
      "KEEP=untouched",
      "MANAGED=old",
      "# mid comment",
      "MANAGED=duplicate",
      "OTHER=stay",
      "",
      "",
    ].join("\n"),
  );

  mergeEnvFile(path, {
    MANAGED: "new",
    APPENDED: "yes",
  });

  expect(readFileSync(path, "utf8")).toBe(
    [
      "# header",
      "",
      "KEEP=untouched",
      "MANAGED=new",
      "# mid comment",
      "OTHER=stay",
      "",
      "",
      "APPENDED=yes",
      "",
    ].join("\n"),
  );
});

test("mergeEnvFile removeKeys deletes matching lines", () => {
  const dir = makeTempDir();
  const path = join(dir, "daemon.env");
  writeFileSync(path, "KEEP=1\nGONE=2\nALSO=3\n");

  mergeEnvFile(path, { KEEP: "1" }, { removeKeys: ["GONE"] });

  expect(readFileSync(path, "utf8")).toBe("KEEP=1\nALSO=3\n");
});

test("mergeEnvFile trims trailing blank lines to a single terminating newline", () => {
  const dir = makeTempDir();
  const path = join(dir, "daemon.env");
  writeFileSync(path, "A=1\n\n\n");

  mergeEnvFile(path, { A: "1" });

  expect(readFileSync(path, "utf8")).toBe("A=1\n");
});

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

// Shape rules for .github/workflows: a red X on a pull request only ever means
// "this change is broken", every workflow says what its token may do (and each
// reusable one tells its callers what they must grant), and every workflow
// reads as a title in the Actions list.

const WORKFLOWS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../.github/workflows",
);
const files = readdirSync(WORKFLOWS).filter((name) => name.endsWith(".yml"));
const read = (name: string) => readFileSync(join(WORKFLOWS, name), "utf8");
const reusable = files.filter((name) =>
  /^on:\n {2}workflow_call:/m.test(read(name)),
);

// Words that stay lower case inside a Title Case name.
const SMALL_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "by",
]);

function isTitleCase(name: string): boolean {
  return name.split(/\s+/).every((word, index) => {
    const bare = word.replace(/^\(/, "");
    if (index > 0 && SMALL_WORDS.has(bare)) return true;
    return !/^[a-z]/.test(bare);
  });
}

/** The `permissions:` block at the top level, as `scope: level` lines. */
function topLevelPermissions(text: string): string[] {
  const block = /^permissions:\n((?: {2}\S.*\n)+)/m.exec(text)?.[1] ?? "";
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The permissions the header tells a caller to grant. */
function callerGrant(text: string): string[] {
  const block =
    /^# Permissions — the caller's job must grant at least:\n#\n# {3}permissions:\n((?:# {5}\S.*\n)+)/m.exec(
      text,
    )?.[1] ?? "";
  return block
    .split("\n")
    .map((line) => line.replace(/^#/, "").trim())
    .filter(Boolean);
}

describe("isTitleCase", () => {
  test("accepts titles and small words after the first", () => {
    expect(isTitleCase("Start the Next Version")).toBe(true);
    expect(isTitleCase("Promote (Prepare)")).toBe(true);
  });

  test("refuses a lower-case word or a lower-case first word", () => {
    expect(isTitleCase("Start a minor")).toBe(false);
    expect(isTitleCase("Promote (prepare)")).toBe(false);
    expect(isTitleCase("the Next Version")).toBe(false);
  });
});

describe(".github/workflows", () => {
  test("has workflows, reusable ones among them", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(reusable).toContain("gh-promote.yml");
  });

  test.each(files)("%s declares top-level permissions", (file) => {
    expect(topLevelPermissions(read(file)).length).toBeGreaterThan(0);
  });

  test.each(files)("%s has a Title Case name", (file) => {
    const name = /^name: (.+)$/m.exec(read(file))?.[1];
    expect(name, `${file} has no top-level name`).toBeDefined();
    expect(isTitleCase(name ?? ""), `${file}: "${name}"`).toBe(true);
  });

  test.each(reusable)(
    "%s tells its callers exactly the permissions it declares",
    (file) => {
      const text = read(file);
      expect(callerGrant(text)).toEqual(topLevelPermissions(text));
    },
  );

  test("the reusable workflows keep their names", () => {
    const names = Object.fromEntries(
      reusable.map((file) => [file, /^name: (.+)$/m.exec(read(file))?.[1]]),
    );
    expect(names).toEqual({
      "gh-canary.yml": "GitHub Canary",
      "gh-promote-ok-recheck.yml": "Promote OK Recheck",
      "gh-promote-ok.yml": "Promote OK",
      "gh-promote-finalize.yml": "Promote (Finalize)",
      "gh-promote.yml": "Promote (Prepare)",
      "gh-release.yml": "GitHub Release",
    });
  });

  test("ci-ok is red on a cancelled pull request but not on a cancelled push", () => {
    const text = read("verify.yml");
    expect(text).toMatch(
      /^ {2}ci-ok:\n {4}name: ci-ok\n {4}needs: \[[^\]]+\]\n {4}if: \$\{\{ \(github\.event_name == 'pull_request' && always\(\)\) \|\| \(!cancelled\(\) && !contains\(needs\.\*\.result, 'cancelled'\)\) \}\}$/m,
    );
    expect(text).not.toMatch(/^ {4}if: always\(\)$/m);
  });

  test.each(files)(
    "%s opens no Start PR and has no minor gate (versions come from tags)",
    (file) => {
      const text = read(file);
      expect(text).not.toMatch(/gh-next-version|gh-minor-gate|minor-gate/);
      expect(text).not.toMatch(/start-minor|--label minor/);
      expect(text).not.toMatch(/--title "Start /);
    },
  );

  test("promote-ok only reads, and its recheck only re-runs runs", () => {
    expect(topLevelPermissions(read("gh-promote-ok.yml"))).toEqual([
      "contents: read",
      "actions: read",
      "pull-requests: read",
    ]);
    expect(read("gh-promote-ok.yml")).toMatch(
      /run: sh \.promote\/scripts\/promote\/promote-ok\.sh$/m,
    );
    expect(
      topLevelPermissions(read("gh-promote-ok-recheck.yml")).filter((p) =>
        p.endsWith("write"),
      ),
    ).toEqual(["actions: write"]);
  });

  test("neither promote-ok workflow reports a check named promote-ok itself", () => {
    // The required check is the caller's fan-in job; a job here would report
    // as "<caller job> / <job>" anyway, and the recheck must never report one.
    for (const file of ["gh-promote-ok.yml", "gh-promote-ok-recheck.yml"]) {
      expect(read(file)).not.toMatch(/^ {4}name: promote-ok$/m);
    }
  });
});

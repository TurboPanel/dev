import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "promote", "changelog.sh");

/** A fake `gh` earlier on PATH that answers `gh api …` with canned compare JSON. */
function run(commits: unknown[], args: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "changelog-"));
  const gh = join(dir, "gh");
  const payload = JSON.stringify({ total_commits: commits.length, commits });
  writeFileSync(
    gh,
    `#!/bin/sh\n# gh api <path> --jq <expr>: the script applies its own jq, so echo raw JSON\ncat <<'JSON'\n${JSON.stringify(
      {
        total: commits.length,
        commits: JSON.parse(payload).commits.filter(
          (c: { parents: unknown[] }) => c.parents.length === 1,
        ),
      },
    )}\nJSON\n`,
  );
  chmodSync(gh, 0o755);
  return execFileSync("sh", [SCRIPT, ...args], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
    encoding: "utf8",
  });
}

const commit = (message: string, author: unknown, parents = 1) => ({
  parents: Array.from({ length: parents }, () => ({ sha: "p" })),
  commit: { message, author: { name: "Git Name" } },
  author,
});

const ana = {
  login: "ana",
  html_url: "https://github.com/ana",
  avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
};

describe("changelog.sh", () => {
  test("puts the contributor's avatar, @name link and the PR number on each commit", () => {
    const out = run(
      [commit("fix: retry the probe (#12)\n\nbody", ana)],
      ["TurboPanel/x", "v0.1.2", "abc"],
    );
    expect(out).toContain(
      '<img src="https://avatars.githubusercontent.com/u/1?v=4&s=40"',
    );
    expect(out).toContain("[@ana](https://github.com/ana)");
    expect(out).toContain("fix: retry the probe (#12)");
    expect(out).not.toContain("body");
    expect(out).toContain("**Thanks to**");
  });

  test("credits each contributor once in the Thanks line", () => {
    const out = run(
      [commit("a (#1)", ana), commit("b (#2)", ana)],
      ["TurboPanel/x", "v0.1.2", "abc"],
    );
    const thanks =
      out.split("\n").find((l) => l.startsWith("**Thanks to**")) ?? "";
    expect(thanks.match(/\[@ana\]/g)).toHaveLength(1);
  });

  test("skips merge commits and falls back to the git name without an account", () => {
    const out = run(
      [
        commit("Merge pull request #9", ana, 2),
        commit("chore: bump (#13)", null),
      ],
      ["TurboPanel/x", "v0.1.2", "abc"],
    );
    expect(out).not.toContain("Merge pull request");
    expect(out).toContain("- Git Name — chore: bump (#13)");
  });

  test("prints nothing without a base (a first release)", () => {
    expect(run([commit("x", ana)], ["TurboPanel/x", "", "abc"])).toBe("");
  });

  test("caps the list and links the full comparison", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      commit(`c${i} (#${i})`, ana),
    );
    const out = run(many, ["TurboPanel/x", "v0.1.2", "abc", "2"]);
    expect(out.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(3);
    expect(out).toContain("and 3 more commits");
    expect(out).toContain(
      "https://github.com/TurboPanel/x/compare/v0.1.2...abc",
    );
  });
});

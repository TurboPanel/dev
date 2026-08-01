import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ALL_DEV_CHECKOUT_DIRS, platformRepoPath } from "./paths.ts";
import { ensureAllGitHooksPaths } from "./platform-install.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../..");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ALL_DEV_CHECKOUT_DIRS", () => {
  test("includes dev and every platform repo", () => {
    expect([...ALL_DEV_CHECKOUT_DIRS].sort((a, b) => a.localeCompare(b))).toEqual(
      ["daemon", "dev", "instance", "ui", "website"].sort((a, b) =>
        a.localeCompare(b),
      ),
    );
  });
});

describe("ensureAllGitHooksPaths", () => {
  test("wires core.hooksPath for present checkouts with .githooks/pre-commit", () => {
    ensureAllGitHooksPaths();
    for (const dir of ALL_DEV_CHECKOUT_DIRS) {
      const root = platformRepoPath(dir);
      if (!existsSync(`${root}/.githooks/pre-commit`)) {
        continue;
      }
      const gitDir = spawnSync("git", ["-C", root, "rev-parse", "--git-dir"], {
        encoding: "utf8",
      });
      if (gitDir.status !== 0) {
        continue;
      }
      const hooksPath = spawnSync(
        "git",
        ["-C", root, "config", "--local", "--get", "core.hooksPath"],
        { encoding: "utf8" },
      );
      expect(hooksPath.stdout.trim(), `${dir} core.hooksPath`).toBe(".githooks");
    }
  });
});

describe("check-git-hooks-path.sh", () => {
  test("exits 0 when every present checkout is wired", () => {
    ensureAllGitHooksPaths();
    const script = join(REPO_ROOT, "scripts/check-git-hooks-path.sh");
    const result = spawnSync("sh", [script], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});

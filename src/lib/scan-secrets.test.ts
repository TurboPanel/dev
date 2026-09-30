import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { type SiblingRepo, siblingCheckout } from "./sibling-checkout.ts";

const DEV_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SCANNER = join(DEV_ROOT, "scripts/scan-secrets.sh");
const SIBLINGS: SiblingRepo[] = ["turbopanel", "turbopaneld", "ui", "website"];

// The same script ships in all five repos. CI checks the siblings out beside
// this repo and requires them (TURBOPANEL_REQUIRE_SIBLINGS), so a drifted
// copy fails here rather than leaving one repo with weaker rules.
describe("scan-secrets.sh is byte-identical in every repo", () => {
  const own = readFileSync(SCANNER, "utf8");
  for (const name of SIBLINGS) {
    const dir = siblingCheckout(name);
    it.skipIf(dir === null)(`${name} carries the same scanner`, () => {
      expect(readFileSync(join(dir!, "scripts/scan-secrets.sh"), "utf8")).toBe(
        own,
      );
    });
  }
});

let workdirs: string[] = [];
afterEach(() => {
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true });
  workdirs = [];
});

function git(cwd: string, ...args: string[]): void {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
}

/** A throwaway repo with the real scanner, an allowlist and some files. */
function repo(files: Record<string, string>, allowlist = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "scan-secrets-"));
  workdirs.push(dir);
  mkdirSync(join(dir, "scripts"));
  copyFileSync(SCANNER, join(dir, "scripts/scan-secrets.sh"));
  writeFileSync(join(dir, ".secretscan-allowlist"), allowlist);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  git(dir, "init", "-q");
  git(dir, "add", ".");
  return dir;
}

function scan(dir: string, ...args: string[]): { code: number; err: string } {
  const res = spawnSync("sh", ["scripts/scan-secrets.sh", ...args], {
    cwd: dir,
    encoding: "utf8",
  });
  return { code: res.status ?? -1, err: res.stderr };
}

describe("scan-secrets.sh rules", () => {
  it("passes ordinary code and prose", () => {
    const dir = repo({
      "src/a.ts":
        "const url = 'https://example.com';\n// TURBOPANEL_SECRET is required\n",
    });
    expect(scan(dir, "--all").code).toBe(0);
  });

  it.each([
    ["amqp://user:pw@host:5672/"],
    ["amqps://user:pw@host/"],
    ["postgres://user:pw@db:5432/app"],
    ["postgresql://user:pw@db/app"],
    ["TURBOPANEL_SECRET=abc"],
    ["TURBOPANEL_SECRETS=k1:abc"],
    ["TURBOPANEL_SECRET: abc"],
    ['{ "TURBOPANEL_SECRETS": "abc" }'],
    ["cat /var/lib/turbopanel/license.token"],
    ["read server-key.json"],
    ["/etc/turbopanel/rabbitmq/.rabbitmq_pass"],
    ["~/.pgpass"],
  ])("flags %s", (line) => {
    const dir = repo({ "src/a.ts": `ok\n${line}\n` });
    const { code, err } = scan(dir, "--all");
    expect(code).toBe(1);
    expect(err).toContain("suspected secret in src/a.ts:2");
  });

  it("refuses a committed secret-bearing file whatever it contains", () => {
    for (const path of [
      "state/license.token",
      "server-key.json",
      "db/.pgpass",
      "x.rabbitmq_pass",
    ]) {
      const dir = repo({ [path]: "harmless\n" });
      const { code, err } = scan(dir, "--all");
      expect(code, path).toBe(1);
      expect(err).toContain(
        `secret-bearing path must not be committed: ${path}`,
      );
    }
  });

  describe("allowlist is keyed by path and full line text", () => {
    const line = "see license.token in the state dir";
    const stale = "docs/a.md:gone license.token line";

    it("accepts an exactly allowlisted line", () => {
      const dir = repo(
        { "docs/a.md": `${line}\n` },
        `# comment\n\ndocs/a.md:${line}\n`,
      );
      const { code, err } = scan(dir, "--all");
      expect(code).toBe(0);
      expect(err).toBe("");
    });

    it("still accepts the line after edits above it shift it down", () => {
      const dir = repo(
        { "docs/a.md": `intro\nmore\n${line}\n` },
        `docs/a.md:${line}\n`,
      );
      expect(scan(dir, "--all").code).toBe(0);
    });

    it("rejects the line once its text changes", () => {
      const dir = repo({ "docs/a.md": `${line}!\n` }, `docs/a.md:${line}\n`);
      const { code, err } = scan(dir, "--all");
      expect(code).toBe(1);
      expect(err).toContain("suspected secret in docs/a.md:1");
    });

    it("rejects a whitespace-only change to the line", () => {
      const dir = repo({ "docs/a.md": `  ${line}\n` }, `docs/a.md:${line}\n`);
      expect(scan(dir, "--all").code).toBe(1);
    });

    it("rejects the same text in a different path", () => {
      const dir = repo({ "docs/b.md": `${line}\n` }, `docs/a.md:${line}\n`);
      const { code, err } = scan(dir, "--all");
      expect(code).toBe(1);
      expect(err).toContain("suspected secret in docs/b.md:1");
    });

    it("accepts the deprecated path:lineno:text form, ignoring the number", () => {
      const dir = repo(
        { "docs/a.md": `intro\n${line}\n` },
        `docs/a.md:1:${line}\n`,
      );
      expect(scan(dir, "--all").code).toBe(0);
    });

    it("rejects a deprecated entry whose text or path differs", () => {
      const changed = repo(
        { "docs/a.md": `${line}!\n` },
        `docs/a.md:1:${line}\n`,
      );
      expect(scan(changed, "--all").code).toBe(1);
      const elsewhere = repo(
        { "docs/b.md": `${line}\n` },
        `docs/a.md:1:${line}\n`,
      );
      expect(scan(elsewhere, "--all").code).toBe(1);
    });

    it("accepts old and new forms side by side", () => {
      const other = "cat ~/.pgpass";
      const dir = repo(
        { "docs/a.md": `x\n${line}\n`, "src/b.ts": `${other}\n` },
        `docs/a.md:7:${line}\nsrc/b.ts:${other}\n`,
      );
      expect(scan(dir, "--all").code).toBe(0);
    });

    it("warns about a stale entry without failing the scan", () => {
      const dir = repo(
        { "docs/a.md": `${line}\n` },
        `docs/a.md:${line}\n${stale}\n`,
      );
      const { code, err } = scan(dir, "--all");
      expect(code).toBe(0);
      expect(err).toContain("stale allowlist entry");
      expect(err).toContain(stale);
      expect(err).not.toContain(`: docs/a.md:${line}`);
    });

    it("does not report stale entries on the staged-files path", () => {
      const dir = repo({ "src/clean.ts": "ok\n" }, `${stale}\n`);
      const { code, err } = scan(dir);
      expect(code).toBe(0);
      expect(err).toBe("");
    });
  });

  it("scans staged files without --all (the pre-commit path)", () => {
    const dir = repo({ "src/clean.ts": "ok\n" });
    git(
      dir,
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-qm",
      "init",
    );
    writeFileSync(join(dir, "src/leak.ts"), "postgres://u:p@h/d\n");
    git(dir, "add", "src/leak.ts");
    const { code, err } = scan(dir);
    expect(code).toBe(1);
    expect(err).toContain("src/leak.ts:1");
  });

  it("refuses to run outside a git repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-secrets-nogit-"));
    workdirs.push(dir);
    mkdirSync(join(dir, "scripts"));
    copyFileSync(SCANNER, join(dir, "scripts/scan-secrets.sh"));
    writeFileSync(join(dir, ".secretscan-allowlist"), "");
    const { code, err } = scan(dir, "--all");
    expect(code).toBe(1);
    expect(err).toContain("not a git repository");
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import { main, makeIo } from "../../scripts/preflight/cli.mjs";
import {
  baseVersion,
  canaryManifests,
  canaryRow,
  checksRow,
  environmentRows,
  findReleasePr,
  formatRow,
  hostedRow,
  latestReleaseVersion,
  manifestRow,
  parseReleasePrTitle,
  prFreshRow,
  prStateRow,
  row,
  summarise,
  summariseChecks,
  versionRows,
} from "../../scripts/preflight/lib.mjs";
import { runPreflight } from "../../scripts/preflight/run.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PREFLIGHT_DIR = join(HERE, "../../scripts/preflight");

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);

function run(id: number, name: string, status: string, conclusion: string | null) {
  return { id, name, status, conclusion };
}

describe("titles and versions", () => {
  test("parses candidate and release titles, rejects anything else", () => {
    expect(parseReleasePrTitle("Release Candidate 0.1.8-rc.1")).toEqual({ kind: "rc", version: "0.1.8-rc.1" });
    expect(parseReleasePrTitle("Release 0.1.8")).toEqual({ kind: "release", version: "0.1.8" });
    expect(parseReleasePrTitle("feat: Release 0.1.8")).toBeNull();
    expect(parseReleasePrTitle("Release Candidate 0.1.8")).toBeNull();
    expect(parseReleasePrTitle("Release 0.1.8-rc.1")).toBeNull();
  });

  test("baseVersion drops the prerelease", () => {
    expect(baseVersion("0.1.8-rc.2")).toBe("0.1.8");
    expect(baseVersion("0.1.8")).toBe("0.1.8");
  });

  test("findReleasePr matches the branches as well as the title", () => {
    const prs = [
      { title: "Release Candidate 0.1.8-rc.1", base: { ref: "main" }, head: { ref: "trunk", sha: SHA } },
      { title: "Release Candidate 0.1.8-rc.1", base: { ref: "staging" }, head: { ref: "trunk", sha: SHA }, number: 7 },
      { title: "Release 0.1.8", base: { ref: "live" }, head: { ref: "staging", sha: OTHER }, number: 8 },
    ];
    expect(findReleasePr(prs, "rc")?.number).toBe(7);
    expect(findReleasePr(prs, "release")?.version).toBe("0.1.8");
    expect(findReleasePr([], "rc")).toBeNull();
  });

  test("latestReleaseVersion ignores rc tags, canary and nonsense", () => {
    const releases = [{ tag_name: "canary" }, { tag_name: "v0.1.7-rc.1" }, { tag_name: "v0.1.10" }, { tag_name: "v0.1.9" }, {}];
    expect(latestReleaseVersion(releases)).toBe("0.1.10");
    expect(latestReleaseVersion([{ tag_name: "canary" }])).toBeNull();
    expect(latestReleaseVersion([{ tag_name: "v0.2.0", draft: true }, { tag_name: "v0.1.9", prerelease: true }, { tag_name: "v0.1.8" }])).toBe("0.1.8");
  });
});

describe("checks", () => {
  test("keeps the newest run per name and counts skipped as green", () => {
    const summary = summariseChecks([
      run(1, "build", "completed", "failure"),
      run(5, "build", "completed", "success"),
      run(2, "dry-run", "completed", "skipped"),
      run(3, "ci-ok", "completed", "success"),
    ]);
    expect(summary.verdict).toBe("green");
    expect(summary.total).toBe(3);
    expect(summary.hasCiOk).toBe(true);
    expect(checksRow("x", "PR", summary).level).toBe("green");
  });

  test("a failed latest run is red, a running or cancelled one is amber, none is amber", () => {
    const failed = summariseChecks([run(1, "build", "completed", "failure")]);
    expect(checksRow("x", "PR", failed)).toMatchObject({ level: "red" });
    expect(checksRow("x", "PR", failed).text).toContain("build (failure)");
    const waiting = summariseChecks([run(1, "build", "in_progress", null), run(2, "rc-pr", "completed", "cancelled")]);
    expect(waiting.waiting).toEqual(["build", "rc-pr (cancelled)"]);
    expect(checksRow("x", "PR", waiting).level).toBe("amber");
    const none = summariseChecks([]);
    expect(none.verdict).toBe("none");
    expect(checksRow("x", "PR", none).level).toBe("amber");
  });

  test("a skipped ci-ok does not count as the gate passing", () => {
    const summary = summariseChecks([run(1, "ci-ok", "completed", "skipped"), run(2, "build", "completed", "success")]);
    expect(summary.hasCiOk).toBe(false);
    expect(checksRow("x", "PR", summary).level).toBe("amber");
  });

  test("the newest run wins even when listed first", () => {
    expect(summariseChecks([run(9, "build", "completed", "failure"), run(3, "build", "completed", "success")]).verdict).toBe("failed");
  });

  test("green checks without ci-ok are amber", () => {
    expect(checksRow("x", "PR", summariseChecks([run(1, "build", "completed", "success")])).level).toBe("amber");
  });
});

describe("canary rail", () => {
  test("sorts by version and then by number, not as text", () => {
    const names = [
      "manifest-0.1.8-canary.9.json",
      "manifest-0.1.8-canary.10.json",
      "manifest-0.1.9-canary.1.json",
      "manifest.json",
      "canary.tar.zst",
    ];
    expect(canaryManifests(names).map((m) => m.name)).toEqual([
      "manifest-0.1.9-canary.1.json",
      "manifest-0.1.8-canary.10.json",
      "manifest-0.1.8-canary.9.json",
    ]);
  });

  const manifests = [
    { name: "n", base: "0.1.8", number: 3, commit: OTHER },
    { name: "n", base: "0.1.8", number: 2, commit: SHA },
  ];

  test("green when a canary was built from the merged commit", () => {
    const result = canaryRow("c", "cp", { headSha: SHA, rcVersion: "0.1.8-rc.1", manifests });
    expect(result.level).toBe("green");
    expect(result.text).toContain("canary 3 is newer");
  });

  test("amber, not red, while the Build of that commit is still running", () => {
    const input = { headSha: "c".repeat(40), rcVersion: "0.1.8-rc.1", manifests };
    expect(canaryRow("c", "cp", { ...input, buildPending: true }).level).toBe("amber");
    expect(canaryRow("c", "cp", { ...input, buildPending: false }).level).toBe("red");
  });

  test("red when no canary has the commit, when the rail is empty, or when the version differs", () => {
    expect(canaryRow("c", "cp", { headSha: "c".repeat(40), rcVersion: "0.1.8-rc.1", manifests }).level).toBe("red");
    expect(canaryRow("c", "cp", { headSha: SHA, rcVersion: "0.1.8-rc.1", manifests: [] }).level).toBe("red");
    expect(canaryRow("c", "cp", { headSha: SHA, rcVersion: "0.2.0-rc.1", manifests }).text).toContain("does not match");
  });
});

describe("pull request rows", () => {
  test("merge state", () => {
    const head = { sha: SHA };
    expect(prStateRow("s", "pr", { title: "", head, draft: true }).level).toBe("red");
    expect(prStateRow("s", "pr", { title: "", head, mergeable_state: "clean" }).level).toBe("green");
    expect(prStateRow("s", "pr", { title: "", head, mergeable_state: "unknown" }).level).toBe("amber");
    expect(prStateRow("s", "pr", { title: "", head, mergeable_state: "blocked" }).level).toBe("red");
    expect(prStateRow("s", "pr", { title: "", head }).level).toBe("amber");
    expect(prStateRow("s", "pr", { title: "", head, mergeable_state: "blocked" }, true).level).toBe("amber");
  });

  test("freshness against trunk", () => {
    expect(prFreshRow("f", "pr", { title: "", head: { sha: SHA } }, SHA).level).toBe("green");
    expect(prFreshRow("f", "pr", { title: "", head: { sha: SHA } }, OTHER).level).toBe("amber");
  });
});

describe("manifests, environments, versions", () => {
  const signed = { version: "0.1.7", signature: { alg: "ed25519", keyId: "c72c6744aa", value: "zzz" } };

  test("manifest rows", () => {
    expect(manifestRow("m", "cp rc", signed).level).toBe("green");
    expect(manifestRow("m", "cp rc", null).level).toBe("red");
    expect(manifestRow("m", "cp rc", { version: "0.1.7" }).level).toBe("red");
    expect(manifestRow("m", "cp rc", { ...signed, signature: { alg: "rsa", keyId: "k", value: "v" } }).level).toBe("red");
  });

  test("environments: all there with an approver is green; gaps are red", () => {
    const levels = (rows: { level: string }[]) => rows.map((r) => r.level);
    expect(levels(environmentRows("r", ["canary", "rc", "release"], ["required_reviewers"]))).toEqual(["green", "green", "green", "green"]);
    expect(levels(environmentRows("r", ["canary", "release"], ["branch_policy"]))).toEqual(["green", "red", "green", "red"]);
  });

  test("environments: unreadable is one amber row, release rules unreadable adds nothing", () => {
    expect(environmentRows("r", null, null)).toHaveLength(1);
    expect(environmentRows("r", null, null)[0].level).toBe("amber");
    const unchecked = environmentRows("r", ["canary", "rc", "release"], null);
    expect(unchecked.map((r) => r.level)).toEqual(["green", "green", "green", "amber"]);
  });

  test("environments: a notes-only repo needs no signing environments and only warns about the approver", () => {
    const rows = environmentRows("website", ["release"], [], "notes-only");
    expect(rows.map((r) => r.level)).toEqual(["green", "amber"]);
  });

  test("versions must agree and move forward", () => {
    const ok = versionRows(
      { turbopanel: "0.1.8-rc.1", turbopaneld: "0.1.8-rc.1", ui: "0.1.7-rc.1", website: "0.1.7-rc.1" },
      { turbopanel: "0.1.7", turbopaneld: "0.1.7", ui: "0.1.6", website: "0.1.6" },
    );
    expect(ok.every((r) => r.level === "green")).toBe(true);
    const split = versionRows({ turbopanel: "0.1.8-rc.1", turbopaneld: "0.1.9-rc.1", ui: "0.1.7-rc.1", website: "0.1.8-rc.1" }, {});
    expect(split.map((r) => r.level)).toEqual(["red", "amber"]);
    const stale = versionRows({ turbopanel: "0.1.7-rc.2" }, { turbopanel: "0.1.7" });
    expect(stale[0].level).toBe("red");
    expect(versionRows({ turbopanel: "0.1.8-rc.1" }, { turbopanel: null })).toEqual([]);
  });

  test("hosted health rows", () => {
    expect(hostedRow("h", "staging", null, SHA).level).toBe("red");
    expect(hostedRow("h", "staging", { revision: { commit: SHA } }, SHA).level).toBe("info");
    expect(hostedRow("h", "staging", { revision: { commit: OTHER } }, SHA).level).toBe("amber");
    expect(hostedRow("h", "staging", {}, undefined).text).toContain("environment ?");
  });
});

describe("summary and output", () => {
  test("counts levels and decides the exit", () => {
    const rows = [row("a", "green", "x"), row("b", "amber", "y"), row("c", "info", "z")];
    expect(summarise(rows)).toEqual({ counts: { green: 1, amber: 1, red: 0, info: 1 }, ok: true, goForMerge: false });
    expect(summarise([row("a", "red", "x")]).ok).toBe(false);
    expect(summarise([row("a", "green", "x")]).goForMerge).toBe(true);
  });

  test("formats with or without colour", () => {
    expect(formatRow(row("a", "red", "boom"))).toBe("RED    boom");
    expect(formatRow(row("a", "green", "fine"), true)).toContain("\u001b[32m");
  });
});

// A whole fake GitHub: four repos, one clean Release Candidate each.
function fakeIo(overrides: { missingCanary?: boolean; hosted?: boolean; denyCanary?: boolean; denyReleaseEnv?: boolean } = {}) {
  const calls: string[] = [];
  const names: Record<string, { version: string; kind: string; released: string }> = {
    turbopanel: { version: "0.1.8-rc.1", kind: "instance", released: "0.1.7" },
    turbopaneld: { version: "0.1.8-rc.1", kind: "daemon", released: "0.1.7" },
    ui: { version: "0.1.7-rc.1", kind: "ui", released: "0.1.6" },
    website: { version: "0.1.7-rc.1", kind: "notes-only", released: "0.1.6" },
  };
  const manifestFor = (v: string) => ({ version: v, commit: SHA, signature: { alg: "ed25519", keyId: "k".repeat(16), value: "v" } });
  const io = {
    async api(path: string) {
      calls.push(path);
      const [, , , repo, kind, rest] = path.split("?")[0].split("/");
      const info = names[repo];
      if (kind === "pulls" && rest === undefined) {
        return [{ number: 1, title: `Release Candidate ${info.version}`, base: { ref: "staging" }, head: { ref: "trunk", sha: SHA } }];
      }
      if (kind === "pulls") return { head: { sha: SHA }, mergeable_state: "clean", draft: false };
      if (kind === "commits" && rest === "trunk") return { sha: SHA };
      if (kind === "commits" && (rest === "staging" || rest === "live")) return { sha: OTHER };
      if (kind === "commits") {
        return { total_count: 2, check_runs: [run(1, "ci-ok", "completed", "success"), run(2, "build", "completed", "success")] };
      }
      if (kind === "releases" && rest === "tags" && overrides.denyCanary) {
        throw Object.assign(new Error("forbidden"), { status: 403 });
      }
      if (kind === "releases" && rest === "tags") {
        const commit = overrides.missingCanary ? OTHER : SHA;
        return { assets: [{ name: `manifest-${baseVersion(info.version)}-canary.2.json` }, { name: `x-${commit}` }] };
      }
      if (kind === "releases") return [{ tag_name: `v${info.released}` }, { tag_name: "canary" }];
      if (kind === "environments" && rest === "release" && overrides.denyReleaseEnv) {
        throw Object.assign(new Error("forbidden"), { status: 403 });
      }
      if (kind === "environments" && rest === "release") return { protection_rules: [{ type: "required_reviewers" }] };
      if (kind === "environments") return { environments: [{ name: "canary" }, { name: "rc" }, { name: "release" }] };
      throw new Error(`unexpected ${path}`);
    },
    async download(url: string) {
      calls.push(url);
      if (url.includes("/health")) return { environment: "staging", version: "0.1.8", revision: { commit: SHA } };
      if (url.includes("/canary/")) return { ...manifestFor("x"), commit: overrides.missingCanary ? OTHER : SHA };
      const repo = url.split("/")[4];
      return manifestFor(names[repo].released);
    },
  };
  return { io, calls };
}

describe("runPreflight", () => {
  test("a clean world has no red and no amber", async () => {
    const { io } = fakeIo();
    const rows = await runPreflight(io);
    expect(rows.filter((r) => r.level === "red")).toEqual([]);
    expect(rows.filter((r) => r.level === "amber")).toEqual([]);
    expect(summarise(rows).goForMerge).toBe(true);
  });

  test("a forbidden read is amber, never a false red or a silent gap", async () => {
    const denied = await runPreflight(fakeIo({ denyCanary: true, denyReleaseEnv: true }).io);
    expect(denied.filter((r) => r.level === "red")).toEqual([]);
    expect(denied.filter((r) => r.id === "turbopanel/canary-latest").map((r) => r.level)).toEqual(["amber"]);
    expect(denied.filter((r) => r.id === "turbopanel/env-release-gate").map((r) => r.level)).toEqual(["amber"]);
  });

  test("a missing canary for the merged commit is red", async () => {
    const { io } = fakeIo({ missingCanary: true });
    const rows = await runPreflight(io);
    expect(rows.some((r) => r.level === "red" && r.id === "turbopanel/canary-for-rc")).toBe(true);
  });

  test("asks only for GitHub REST paths and public downloads; hosted probes are opt-in", async () => {
    const quiet = fakeIo();
    await runPreflight(quiet.io);
    expect(quiet.calls.some((c) => c.includes("/health"))).toBe(false);
    for (const call of quiet.calls) expect(call.startsWith("/repos/TurboPanel/") || call.startsWith("https://github.com/TurboPanel/")).toBe(true);
    const loud = fakeIo();
    const rows = await runPreflight(loud.io, { hosted: true });
    expect(loud.calls.filter((c) => c.includes("/health"))).toEqual([
      "https://staging.turbopanel.dev/api/health",
      "https://turbopanel.app/api/health",
    ]);
    expect(rows.filter((r) => r.id.startsWith("hosted/")).map((r) => r.level)).toEqual(["amber", "amber"]);
  });

  test("a repo with no open Release Candidate is amber and skips the RC checks", async () => {
    const { io } = fakeIo();
    const bare = { ...io, api: async (path: string) => (path.includes("/pulls?") ? [] : io.api(path)) };
    const rows = await runPreflight(bare);
    expect(rows.filter((r) => r.id.endsWith("/rc-pr")).every((r) => r.level === "amber")).toBe(true);
    expect(rows.some((r) => r.id.endsWith("/canary-for-rc"))).toBe(false);
  });
});

describe("read-only guarantee", () => {
  test("makeIo sends GET and nothing else, and turns HTTP errors into a status", async () => {
    const doFetch = vi.fn(async (_url: string, init?: RequestInit) =>
      Response.json({ ok: true }, { status: String(_url).includes("missing") ? 404 : 200, headers: init?.headers }),
    );
    const io = makeIo("token", doFetch as unknown as typeof fetch);
    await expect(io.api("/repos/x")).resolves.toEqual({ ok: true });
    await expect(io.download("https://example.com/a")).resolves.toEqual({ ok: true });
    await expect(io.download("https://example.com/missing")).resolves.toBeNull();
    await expect(io.api("/missing")).rejects.toMatchObject({ status: 404 });
    for (const [, init] of doFetch.mock.calls) expect(init?.method).toBe("GET");
    const auth = (doFetch.mock.calls[0][1]?.headers as Record<string, string>).authorization;
    expect(auth).toBe("Bearer token");
  });

  test("a network failure on a download is just 'does not resolve'", async () => {
    const io = makeIo("", (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch);
    await expect(io.download("https://example.com/a")).resolves.toBeNull();
  });

  test("no preflight source file names a writing HTTP method or a GraphQL command", () => {
    for (const file of readdirSync(PREFLIGHT_DIR).filter((f) => f.endsWith(".mjs"))) {
      const source = readFileSync(join(PREFLIGHT_DIR, file), "utf8");
      expect(source, file).not.toMatch(/method:\s*["'`](POST|PUT|PATCH|DELETE)/i);
      expect(source, file).not.toMatch(/gh\s+(pr|api\s+graphql)|["']-[fF]["']|--method/);
    }
  });
});

describe("main", () => {
  async function exitFor(argv: string[], overrides: Parameters<typeof fakeIo>[0] = {}) {
    const out: string[] = [];
    const code = await main(argv, (line: string) => out.push(line), fakeIo(overrides).io);
    return { code, out };
  }

  test("exit 0 and READY when nothing is red or amber", async () => {
    const { code, out } = await exitFor(["--no-color", "--strict"]);
    expect(code).toBe(0);
    expect(out.at(-1)).toContain("READY");
  });

  test("exit 1 and STOP when something is red", async () => {
    const { code, out } = await exitFor(["--no-color"], { missingCanary: true });
    expect(code).toBe(1);
    expect(out.at(-1)).toContain("STOP");
  });

  test("amber exits 0 normally and 1 with --strict", async () => {
    expect((await exitFor([], { denyReleaseEnv: true })).code).toBe(0);
    const strict = await exitFor(["--strict"], { denyReleaseEnv: true });
    expect(strict.code).toBe(1);
    expect(strict.out.at(-1)).toContain("NOT YET");
  });

  test("exit 2 with one plain line when GitHub cannot be read, and the token never shows", async () => {
    const out: string[] = [];
    const io = makeIo("secret-token", (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch);
    expect(await main(["--no-color"], (line: string) => out.push(line), io)).toBe(2);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("could not read GitHub");
    expect(out.join("\n")).not.toContain("secret-token");
  });
});

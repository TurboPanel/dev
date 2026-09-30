import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = join(ROOT, "scripts", "promote", "promote-ok.sh");
const RECHECK = join(ROOT, "scripts", "promote", "promote-recheck.sh");

/**
 * A route: the first whose pattern matches the joined `gh` arguments answers.
 * `body` is the raw API JSON (the fake applies `--jq` with the real jq, so the
 * script's filters are exercised); `file` is what `gh release download
 * --output` writes; `exit` fails the call.
 */
type Route = { match: RegExp; body?: unknown; file?: unknown; exit?: number };

// The fake gh (node, so it can apply --jq with the real jq and log each call).
const FAKE_GH = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const line = args.join(" ");
appendFileSync(process.env.FAKE_GH_LOG, line + "\\n");
const routes = JSON.parse(readFileSync(process.env.FAKE_GH_ROUTES, "utf8"));
const route = routes.find((r) => new RegExp(r.match).test(line));
if (!route) { process.stderr.write("fake gh: no route for " + line + "\\n"); process.exit(1); }
if (route.exit) { process.stderr.write("HTTP 404\\n"); process.exit(route.exit); }
const out = args.indexOf("--output");
if (out >= 0) { writeFileSync(args[out + 1], JSON.stringify(route.file)); process.exit(0); }
const jq = args.indexOf("--jq");
const body = JSON.stringify(route.body ?? null);
if (jq < 0) { if (route.body !== undefined) process.stdout.write(body + "\\n"); process.exit(0); }
const r = spawnSync("jq", ["-r", args[jq + 1]], { input: body, encoding: "utf8" });
process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exit(r.status ?? 1);
`;

type Result = { status: number; out: string; calls: string[] };

function run(
  script: string,
  routes: Route[],
  env: Record<string, string>,
): Result {
  const dir = mkdtempSync(join(tmpdir(), "promote-ok-"));
  writeFileSync(join(dir, "gh"), FAKE_GH);
  chmodSync(join(dir, "gh"), 0o755);
  // The recheck waits between looks at a running check: no real sleeping.
  writeFileSync(join(dir, "sleep"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, "sleep"), 0o755);
  const routesFile = join(dir, "routes.json");
  writeFileSync(
    routesFile,
    JSON.stringify(routes.map((r) => ({ ...r, match: r.match.source }))),
  );
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  const summary = join(dir, "summary.md");
  const r = spawnSync("/bin/sh", [script], {
    env: {
      PATH: `${dir}:${process.env.PATH ?? ""}`,
      FAKE_GH_ROUTES: routesFile,
      FAKE_GH_LOG: log,
      GITHUB_STEP_SUMMARY: summary,
      ...env,
    },
    encoding: "utf8",
  });
  return {
    status: r.status ?? -1,
    out: `${r.stdout}${r.stderr}`,
    calls: readFileSync(log, "utf8").split("\n").filter(Boolean),
  };
}

const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);
const base64 = (text: string) => Buffer.from(text).toString("base64");
const versionFile = (version: string): Route => ({
  match: /^api repos\/o\/r\/contents\/deno\.json\?ref=/,
  body: { content: base64(JSON.stringify({ version })) },
});

const checkEnv = (base: string, kind = "instance") => ({
  REPO: "o/r",
  REPO_KIND: kind,
  CI_WORKFLOW: "build.yml",
  VERSION_FILE: "deno.json",
  BASE: base,
  HEAD_SHA: HEAD,
});

const ciRuns = (...runs: Record<string, string>[]): Route => ({
  match: /^api repos\/o\/r\/actions\/workflows\/build\.yml\/runs\?/,
  body: { workflow_runs: runs },
});
const run1 = (over: Record<string, string>) => ({
  event: "push",
  status: "completed",
  conclusion: "success",
  created_at: "2026-09-29T10:00:00Z",
  ...over,
});

const canaryAssets = (...names: string[]): Route => ({
  match: /^release view canary/,
  body: { assets: names.map((name) => ({ name })) },
});
const manifest = (name: string, commit: string): Route => ({
  match: new RegExp(
    `^release download canary .*--pattern ${name.replaceAll(".", "\\.")} `,
  ),
  file: { commit },
});

describe("promote-ok.sh — Release Candidate PR (base staging)", () => {
  test("green when the trunk run passed and a canary names the head commit", () => {
    const r = run(
      CHECK,
      [
        ciRuns(run1({})),
        versionFile("0.1.4"),
        canaryAssets(
          "manifest-0.1.4-canary.9.json",
          "manifest-0.1.4-canary.10.json",
          "manifest-0.1.3-canary.99.json",
          "turbopanel-0.1.4-canary.10-amd64.tar.zst",
        ),
        manifest("manifest-0.1.4-canary.10.json", HEAD),
      ],
      checkEnv("staging"),
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("PASS");
    expect(r.out).toContain("manifest-0.1.4-canary.10.json");
    // Newest first, stops at the first match; another version is never read.
    const downloads = r.calls.filter((c) => c.startsWith("release download"));
    expect(downloads).toHaveLength(1);
    expect(r.calls.join("\n")).not.toContain("0.1.3-canary.99");
  });

  test("red, waiting, while no canary names the head commit yet", () => {
    const r = run(
      CHECK,
      [
        ciRuns(run1({})),
        versionFile("0.1.4"),
        canaryAssets("manifest-0.1.4-canary.9.json"),
        manifest("manifest-0.1.4-canary.9.json", OTHER),
      ],
      checkEnv("staging"),
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      "waiting for the canary of aaaaaaa (no manifest-0.1.4-canary.N.json on the canary release names it yet); this re-checks automatically. If the canary run for it failed, re-run that run.",
    );
    expect(r.out).toContain("::error title=promote-ok::");
  });

  test("red, waiting, while the trunk run is still going or has not started", () => {
    const pending = run(
      CHECK,
      [ciRuns(run1({ status: "in_progress", conclusion: "" }))],
      checkEnv("staging"),
    );
    expect(pending.status).toBe(1);
    expect(pending.out).toContain(
      "waiting for the trunk build.yml run of aaaaaaa to finish; this re-checks automatically.",
    );
    const missing = run(
      CHECK,
      [ciRuns(run1({ event: "pull_request" }))],
      checkEnv("staging"),
    );
    expect(missing.status).toBe(1);
    expect(missing.out).toContain("none has started yet");
  });

  test("red, plainly, when the trunk run failed (no canary will ever come)", () => {
    const r = run(
      CHECK,
      [
        ciRuns(
          run1({ conclusion: "success", created_at: "2026-09-29T09:00:00Z" }),
          run1({ conclusion: "failure", created_at: "2026-09-29T10:00:00Z" }),
        ),
      ],
      checkEnv("staging"),
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("ended 'failure', so it will never get a canary");
  });

  test("a manual trunk run counts like a push", () => {
    const r = run(
      CHECK,
      [ciRuns(run1({ event: "workflow_dispatch" }))],
      checkEnv("staging", "notes-only"),
    );
    expect(r.status).toBe(0);
  });

  test("notes-only repos need only the green trunk run", () => {
    const r = run(CHECK, [ciRuns(run1({}))], checkEnv("staging", "notes-only"));
    expect(r.status).toBe(0);
    expect(r.out).toContain("notes-only repo, no canary");
    expect(r.calls.join("\n")).not.toContain("release view canary");
  });
});

describe("promote-ok.sh — Release PR (base live)", () => {
  const RC = "c".repeat(40);
  const noBareTag: Route = {
    match: /^api repos\/o\/r\/git\/ref\/tags\/v0\.1\.4 --silent/,
    exit: 1,
  };
  const rcTags: Route = {
    match: /matching-refs\/tags\/v0\.1\.4-rc\./,
    body: [
      { ref: "refs/tags/v0.1.4-rc.2" },
      { ref: "refs/tags/v0.1.4-rc.10" },
      { ref: "refs/tags/v0.1.4-rc.9" },
    ],
  };
  const published: Route = {
    match: /^api repos\/o\/r\/releases\/tags\/v0\.1\.4-rc\.10/,
    body: { draft: false },
  };
  const compare = (behind: number, tree: string): Route => ({
    match: /^api repos\/o\/r\/compare\/v0\.1\.4-rc\.10\.\.\./,
    body: {
      behind_by: behind,
      base_commit: { sha: RC, commit: { tree: { sha: tree } } },
    },
  });
  const headTree: Route = {
    match: /^api repos\/o\/r\/git\/commits\//,
    body: { tree: { sha: "tree-1" } },
  };

  test("green when the newest rc is published and staging is exactly it", () => {
    const r = run(
      CHECK,
      [
        versionFile("0.1.4"),
        noBareTag,
        rcTags,
        published,
        compare(0, "tree-1"),
        headTree,
      ],
      checkEnv("live"),
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("v0.1.4-rc.10 is published");
  });

  test("red when staging has changes the newest rc lacks", () => {
    const r = run(
      CHECK,
      [
        versionFile("0.1.4"),
        noBareTag,
        rcTags,
        published,
        compare(0, "tree-0"),
        headTree,
      ],
      checkEnv("live"),
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      "has changes that are not in v0.1.4-rc.10 (the newest rc). Waiting for Publish Release Candidate",
    );
  });

  test("red when staging does not contain the newest rc", () => {
    const r = run(
      CHECK,
      [
        versionFile("0.1.4"),
        noBareTag,
        rcTags,
        published,
        compare(3, "tree-1"),
        headTree,
      ],
      checkEnv("live"),
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("does not contain v0.1.4-rc.10");
  });

  test("red while the rc has no published release, or no rc exists", () => {
    const draft = run(
      CHECK,
      [
        versionFile("0.1.4"),
        noBareTag,
        rcTags,
        { ...published, body: { draft: true } },
      ],
      checkEnv("live"),
    );
    expect(draft.status).toBe(1);
    expect(draft.out).toContain("waiting for the v0.1.4-rc.10 GitHub release");
    const none = run(
      CHECK,
      [versionFile("0.1.4"), noBareTag, { ...rcTags, body: [] }],
      checkEnv("live"),
    );
    expect(none.status).toBe(1);
    expect(none.out).toContain("no v0.1.4-rc.N exists yet");
  });

  test("red when the version is already released", () => {
    const r = run(
      CHECK,
      [versionFile("0.1.4"), { ...noBareTag, exit: 0, body: {} }],
      checkEnv("live"),
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("v0.1.4 is already released");
  });

  test("red on an unreadable version file", () => {
    const r = run(CHECK, [versionFile("oops")], checkEnv("live"));
    expect(r.status).toBe(1);
    expect(r.out).toContain("could not read a version from deno.json");
  });
});

describe("promote-ok.sh — inputs", () => {
  test("a PR number supplies base and head (the dry run)", () => {
    const r = run(
      CHECK,
      [
        {
          match: /^api repos\/o\/r\/pulls\/7 /,
          body: {
            base: { ref: "staging" },
            head: { sha: HEAD },
            state: "open",
          },
        },
        ciRuns(run1({})),
      ],
      { ...checkEnv("", "notes-only"), HEAD_SHA: "", PR_NUMBER: "7" },
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("PR #7 (open): base staging, head " + HEAD);
    expect(r.calls.some((c) => c.includes(`head_sha=${HEAD}`))).toBe(true);
  });

  test("refuses other bases and missing configuration", () => {
    const trunk = run(CHECK, [], checkEnv("trunk"));
    expect(trunk.status).toBe(1);
    expect(trunk.out).toContain("only gates PRs into staging or live");
    const bare = run(CHECK, [], { ...checkEnv("staging"), CI_WORKFLOW: "" });
    expect(bare.status).toBe(1);
    expect(bare.out).toContain("CI_WORKFLOW is not set");
  });
});

describe("promote-recheck.sh", () => {
  const env = { REPO: "o/r", WORKFLOW: "promote-ok.yml", WAIT_POLLS: "2" };
  const prs = (rc: unknown[], release: unknown[]): Route[] => [
    { match: /^pr list .*--base staging --head trunk/, body: rc },
    { match: /^pr list .*--base live --head staging/, body: release },
  ];
  const runs = (sha: string, body: unknown[]): Route => ({
    match: new RegExp(`^run list .*--commit ${sha}`),
    body,
  });
  const rerunRoute: Route = { match: /^run rerun /, body: {} };

  test("re-runs the failed promote-ok run of each open PR's head", () => {
    const r = run(
      RECHECK,
      [
        ...prs(
          [{ number: 5, headRefOid: HEAD }],
          [{ number: 6, headRefOid: OTHER }],
        ),
        runs(HEAD, [
          { databaseId: 11, status: "completed", conclusion: "failure" },
        ]),
        runs(OTHER, [
          { databaseId: 12, status: "completed", conclusion: "success" },
        ]),
        rerunRoute,
      ],
      env,
    );
    expect(r.status).toBe(0);
    expect(r.calls).toContain("run rerun 11 --repo o/r --failed");
    expect(r.calls.join("\n")).not.toContain("run rerun 12");
    expect(r.out).toContain("PR #6: promote-ok is already green");
    expect(
      r.calls.some((c) =>
        c.includes("--workflow promote-ok.yml --event pull_request"),
      ),
    ).toBe(true);
  });

  test("dry run reports and changes nothing", () => {
    const r = run(
      RECHECK,
      [
        ...prs([{ number: 5, headRefOid: HEAD }], []),
        runs(HEAD, [
          { databaseId: 11, status: "completed", conclusion: "failure" },
        ]),
      ],
      { ...env, DRY_RUN: "true" },
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain(
      "would re-run the failed promote-ok run 11 (dry run)",
    );
    expect(r.calls.join("\n")).not.toContain("run rerun");
    expect(r.out).toContain("staging -> live: no open PR");
  });

  test("waits for a running check, then warns without failing if it never settles", () => {
    const r = run(
      RECHECK,
      [
        ...prs([{ number: 5, headRefOid: HEAD }], []),
        runs(HEAD, [{ databaseId: 11, status: "in_progress", conclusion: "" }]),
      ],
      env,
    );
    expect(r.status).toBe(0);
    expect(r.calls.filter((c) => c.startsWith("run list"))).toHaveLength(3);
    expect(r.out).toContain("still 'in_progress' after waiting");
  });

  test("never fails: no run yet, or a refused re-run, is a warning", () => {
    const noRun = run(
      RECHECK,
      [...prs([{ number: 5, headRefOid: HEAD }], []), runs(HEAD, [])],
      env,
    );
    expect(noRun.status).toBe(0);
    expect(noRun.out).toContain("no promote-ok run for its head");
    const refused = run(
      RECHECK,
      [
        ...prs([{ number: 5, headRefOid: HEAD }], []),
        runs(HEAD, [
          { databaseId: 11, status: "completed", conclusion: "cancelled" },
        ]),
        { match: /^run rerun /, exit: 1 },
      ],
      env,
    );
    expect(refused.status).toBe(0);
    expect(refused.out).toContain("could not re-run promote-ok run 11");
    const unset = run(RECHECK, [], { REPO: "" });
    expect(unset.status).toBe(0);
    expect(unset.out).toContain("needs REPO and WORKFLOW");
  });
});

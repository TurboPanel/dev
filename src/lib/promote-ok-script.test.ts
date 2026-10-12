import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = join(ROOT, "scripts", "promote", "promote-ok.sh");
const RECHECK = join(ROOT, "scripts", "promote", "promote-recheck.sh");
const VERSION = join(ROOT, "scripts", "promote", "version.sh");
const START = join(ROOT, "scripts", "promote", "start-version.sh");

/**
 * A route: the first whose pattern matches the joined `gh` arguments answers.
 * `body` is the raw API JSON (the fake applies `--jq` with the real jq, so the
 * script's filters are exercised); `file` is what `gh release download
 * --output` writes; `exit` fails the call. `sequence`, when set, answers with
 * `body` `sequence[0]`, then `sequence[1]`, … on each successive match of
 * this route, holding on the last entry once exhausted — for proving a retry
 * loop polls more than once before it settles.
 */
type Route = {
  match: RegExp;
  body?: unknown;
  file?: unknown;
  exit?: number;
  stderr?: string;
  sequence?: unknown[];
};

// The fake gh (node, so it can apply --jq with the real jq and log each call).
// FAKE_GH_STATE counts, per route index, how many times that route has
// already answered — only read/written when the route carries a `sequence`.
// Every file a call sends (`--input <file>`, `-F key=@<file>`) is appended,
// as one JSON string per line, to <FAKE_GH_LOG>.files.
const FAKE_GH = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const line = args.join(" ");
appendFileSync(process.env.FAKE_GH_LOG, line + "\\n");
for (let i = 0; i < args.length; i++) {
  const sent = args[i] === "--input" ? args[i + 1] : /^[\\w-]+=@(.+)$/.exec(args[i])?.[1];
  if (sent) appendFileSync(process.env.FAKE_GH_LOG + ".files", JSON.stringify(readFileSync(sent, "utf8")) + "\\n");
}
const routes = JSON.parse(readFileSync(process.env.FAKE_GH_ROUTES, "utf8"));
const idx = routes.findIndex((r) => new RegExp(r.match).test(line));
if (idx < 0) { process.stderr.write("fake gh: no route for " + line + "\\n"); process.exit(1); }
const route = routes[idx];
if (route.exit) { process.stderr.write((route.stderr ?? "HTTP 404") + "\\n"); process.exit(route.exit); }
let body = route.body;
if (route.sequence) {
  const state = JSON.parse(readFileSync(process.env.FAKE_GH_STATE, "utf8"));
  const seen = state[idx] ?? 0;
  body = route.sequence[Math.min(seen, route.sequence.length - 1)];
  state[idx] = seen + 1;
  writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(state));
}
const out = args.indexOf("--output");
if (out >= 0) { writeFileSync(args[out + 1], JSON.stringify(route.file)); process.exit(0); }
const jq = args.indexOf("--jq");
const bodyStr = JSON.stringify(body ?? null);
if (jq < 0) { if (body !== undefined) process.stdout.write(bodyStr + "\\n"); process.exit(0); }
const r = spawnSync("jq", ["-r", args[jq + 1]], { input: bodyStr, encoding: "utf8" });
process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exit(r.status ?? 1);
`;

type Result = { status: number; out: string; calls: string[]; sent: string[] };

function run(
  script: string,
  routes: Route[],
  env: Record<string, string>,
  args: string[] = [],
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
  writeFileSync(`${log}.files`, "");
  const state = join(dir, "state.json");
  writeFileSync(state, "{}");
  const summary = join(dir, "summary.md");
  const r = spawnSync("/bin/sh", [script, ...args], {
    env: {
      PATH: `${dir}:${process.env.PATH ?? ""}`,
      FAKE_GH_ROUTES: routesFile,
      FAKE_GH_LOG: log,
      FAKE_GH_STATE: state,
      GITHUB_STEP_SUMMARY: summary,
      ...env,
    },
    encoding: "utf8",
  });
  return {
    status: r.status ?? -1,
    out: `${r.stdout}${r.stderr}`,
    calls: readFileSync(log, "utf8").split("\n").filter(Boolean),
    sent: readFileSync(`${log}.files`, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string),
  };
}

const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);
/** Every tag of o/r, as `gh api --paginate …/matching-refs/tags/` lists them. */
const tags = (...names: string[]): Route => ({
  match: /^api --paginate repos\/o\/r\/git\/matching-refs\/tags\/ /,
  body: names.map((name) => ({ ref: `refs/tags/${name}` })),
});

// Every "not ready yet" case is a single check here: the deadline is already
// past before the first look, so it fails on the same look it always did, and
// the fail message — proven byte-identical to before the retry loop existed —
// is the same one production would eventually give up with too.
const checkEnv = (base: string, kind = "instance") => ({
  REPO: "o/r",
  REPO_KIND: kind,
  CI_WORKFLOW: "build.yml",
  BASE: base,
  HEAD_SHA: HEAD,
  MAX_WAIT_SECONDS: "0",
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
    expect(r.out).toContain(
      "canary manifest-0.1.4-canary.10.json was built from aaaaaaa; merging publishes the next 0.1.4 rc from those bytes.",
    );
    // Newest first (highest version, then counter), stops at the first match;
    // no version file is read.
    const downloads = r.calls.filter((c) => c.startsWith("release download"));
    expect(downloads).toHaveLength(1);
    expect(r.calls.join("\n")).not.toContain("0.1.3-canary.99");
    expect(r.calls.join("\n")).not.toContain("contents/");
  });

  test("red, waiting, while no canary names the head commit yet", () => {
    const r = run(
      CHECK,
      [
        ciRuns(run1({})),
        canaryAssets("manifest-0.1.4-canary.9.json"),
        manifest("manifest-0.1.4-canary.9.json", OTHER),
      ],
      checkEnv("staging"),
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      "waiting for the canary of aaaaaaa (no manifest-X.Y.Z-canary.N.json on the canary release names it yet); this re-checks automatically. If the canary run for it failed, re-run that run.",
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

  test("polls in place instead of failing once: a still-running trunk run that then succeeds", () => {
    const runsRoute = {
      match: /^api repos\/o\/r\/actions\/workflows\/build\.yml\/runs\?/,
      sequence: [
        { workflow_runs: [run1({ status: "in_progress", conclusion: "" })] },
        { workflow_runs: [run1({ status: "in_progress", conclusion: "" })] },
        { workflow_runs: [run1({})] },
      ],
    };
    const r = run(CHECK, [runsRoute], {
      ...checkEnv("staging", "notes-only"),
      MAX_WAIT_SECONDS: "60",
    });
    expect(r.status).toBe(0);
    expect(r.out).toContain("PASS");
    // Never printed a red X while it was still waiting.
    expect(r.out).not.toContain("::error");
    const looks = r.calls.filter((c) =>
      c.startsWith("api repos/o/r/actions/workflows"),
    );
    expect(looks.length).toBeGreaterThanOrEqual(3);
  });

  test("still red after really running out of time, not on the first look", () => {
    const alwaysPending = {
      match: /^api repos\/o\/r\/actions\/workflows\/build\.yml\/runs\?/,
      sequence: [
        { workflow_runs: [run1({ status: "in_progress", conclusion: "" })] },
      ],
    };
    const r = run(CHECK, [alwaysPending], {
      ...checkEnv("staging", "notes-only"),
      MAX_WAIT_SECONDS: "1",
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      "waiting for the trunk build.yml run of aaaaaaa to finish; this re-checks automatically.",
    );
    const looks = r.calls.filter((c) =>
      c.startsWith("api repos/o/r/actions/workflows"),
    );
    expect(looks.length).toBeGreaterThanOrEqual(1);
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
  const released = ["v0.1.3", "v0.1.3-rc.1"];
  const rcTags = tags(
    ...released,
    "v0.1.4-rc.2",
    "v0.1.4-rc.10",
    "v0.1.4-rc.9",
  );
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

  test("green when the newest unreleased rc is published and staging is exactly it", () => {
    const r = run(
      CHECK,
      [rcTags, published, compare(0, "tree-1"), headTree],
      checkEnv("live"),
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain(
      "v0.1.4-rc.10 is published and staging (aaaaaaa) is exactly its content; merging releases v0.1.4 from it.",
    );
    expect(r.calls.join("\n")).not.toContain("contents/");
  });

  test("a started minor does not strand the patch rc staging already holds", () => {
    const r = run(
      CHECK,
      [
        tags(...released, "start/v0.2.0", "v0.1.4-rc.10"),
        published,
        compare(0, "tree-1"),
        headTree,
      ],
      checkEnv("live"),
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("merging releases v0.1.4 from it.");
  });

  test("red when staging has changes the newest rc lacks", () => {
    const r = run(
      CHECK,
      [rcTags, published, compare(0, "tree-0"), headTree],
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
      [rcTags, published, compare(3, "tree-1"), headTree],
      checkEnv("live"),
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("does not contain v0.1.4-rc.10");
  });

  test("red while the rc has no published release, or every rc has shipped", () => {
    const draft = run(
      CHECK,
      [rcTags, { ...published, body: { draft: true } }],
      checkEnv("live"),
    );
    expect(draft.status).toBe(1);
    expect(draft.out).toContain("waiting for the v0.1.4-rc.10 GitHub release");
    const shipped = run(
      CHECK,
      [tags(...released, "v0.1.4-rc.10", "v0.1.4")],
      checkEnv("live"),
    );
    expect(shipped.status).toBe(1);
    expect(shipped.out).toContain(
      "no rc newer than the latest release exists yet; merge the Release Candidate PR first.",
    );
  });

  test("red when the tags cannot be listed", () => {
    const r = run(CHECK, [{ ...tags(), exit: 1 }], checkEnv("live"));
    expect(r.status).toBe(1);
    expect(r.out).toContain("could not work out the newest rc from o/r's tags");
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

describe("version.sh — numbers from tags, never a file", () => {
  const env = { REPO: "o/r" };
  const daemon = tags(
    "canary",
    "rc",
    "v0.1.0",
    "v0.1.1-rc.1",
    "v0.1.4",
    "v0.1.5",
    "v0.1.5-rc.2",
  );

  test("base: the newest release's next patch", () => {
    const r = run(VERSION, [daemon], env, ["base"]);
    expect(r.status).toBe(0);
    expect(r.out).toBe("release=0.1.5\nbase=0.1.6\n");
    expect(r.calls.join("\n")).not.toContain("contents/");
  });

  test("base: a start/ marker lifts it to the started minor", () => {
    const r = run(VERSION, [tags("v0.1.5", "start/v0.2.0")], env, ["base"]);
    expect(r.out).toContain("base=0.2.0");
  });

  test("canary: continues the base's counter, and restarts at 1 for a new base", () => {
    const assets = canaryAssets(
      "manifest.json",
      "manifest-0.1.5-canary.449.json",
      "manifest-0.1.6-canary.450.json",
    );
    const inFlight = run(VERSION, [daemon, assets], env, ["canary"]);
    expect(inFlight.status).toBe(0);
    expect(inFlight.out).toBe(
      "base=0.1.6\nnumber=451\nversion=0.1.6-canary.451\n",
    );
    const next = run(VERSION, [tags("v0.1.6"), assets], env, ["canary"]);
    expect(next.out).toContain("version=0.1.7-canary.1");
  });

  test("canary: a repo with no canary release starts at 1; any other failure stops", () => {
    const none = run(
      VERSION,
      [
        daemon,
        { match: /^release view canary/, exit: 1, stderr: "release not found" },
      ],
      env,
      ["canary"],
    );
    expect(none.status).toBe(0);
    expect(none.out).toContain("version=0.1.6-canary.1");
    const broken = run(
      VERSION,
      [daemon, { match: /^release view canary/, exit: 1, stderr: "HTTP 502" }],
      env,
      ["canary"],
    );
    expect(broken.status).toBe(1);
    expect(broken.out).toContain("could not read o/r's canary release");
    expect(broken.out).not.toContain("version=");
  });

  test("canary-of: the manifest copy built from the commit, newest first", () => {
    const r = run(
      VERSION,
      [
        canaryAssets(
          "manifest-0.1.6-canary.2.json",
          "manifest-0.1.6-canary.10.json",
          "manifest-0.1.5-canary.449.json",
        ),
        manifest("manifest-0.1.6-canary.10.json", OTHER),
        manifest("manifest-0.1.6-canary.2.json", HEAD),
      ],
      env,
      ["canary-of", HEAD],
    );
    expect(r.status).toBe(0);
    expect(r.out).toBe(
      "asset=manifest-0.1.6-canary.2.json\nversion=0.1.6-canary.2\nbase=0.1.6\n",
    );
    expect(r.calls.join("\n")).not.toContain("0.1.5-canary.449");
  });

  test("canary-of: empty answers when no canary names the commit; a commit is required", () => {
    const r = run(
      VERSION,
      [
        canaryAssets("manifest-0.1.6-canary.1.json"),
        manifest("manifest-0.1.6-canary.1.json", OTHER),
      ],
      env,
      ["canary-of", HEAD],
    );
    expect(r.status).toBe(0);
    expect(r.out).toBe("asset=\nversion=\nbase=\n");
    const bare = run(VERSION, [], env, ["canary-of"]);
    expect(bare.status).toBe(1);
    expect(bare.out).toContain("canary-of needs a commit");
  });

  test("release-rc: the newest unreleased rc, appended to GITHUB_OUTPUT too", () => {
    const dir = mkdtempSync(join(tmpdir(), "version-out-"));
    const output = join(dir, "out");
    writeFileSync(output, "");
    const r = run(
      VERSION,
      [tags("v0.1.5", "v0.1.6-rc.1", "v0.1.6-rc.2")],
      { ...env, GITHUB_OUTPUT: output },
      ["release-rc"],
    );
    expect(r.status).toBe(0);
    expect(readFileSync(output, "utf8")).toBe(
      "rc-tag=v0.1.6-rc.2\nversion=0.1.6\n",
    );
  });

  test("refuses an unknown mode, a missing REPO, and an unlistable tag set", () => {
    expect(run(VERSION, [], env, ["next"]).out).toContain("usage: version.sh");
    expect(run(VERSION, [], {}, ["base"]).out).toContain("REPO is not set");
    const r = run(VERSION, [{ ...daemon, exit: 1 }], env, ["base"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("could not list o/r's tags");
  });
});

describe("start-version.sh — Start Next Version", () => {
  const repoTags = (repo: string, ...names: string[]): Route => ({
    match: new RegExp(
      `^api --paginate repos/o/${repo}/git/matching-refs/tags/ `,
    ),
    body: names.map((name) => ({ ref: `refs/tags/${name}` })),
  });
  const trunkHead = (repo: string): Route => ({
    match: new RegExp(`^api repos/o/${repo}/commits/trunk `),
    body: { sha: HEAD },
  });
  const tagObject = (repo: string): Route => ({
    match: new RegExp(`^api --method POST repos/o/${repo}/git/tags `),
    body: { sha: OTHER },
  });
  const tagRef = (repo: string): Route => ({
    match: new RegExp(`^api --method POST repos/o/${repo}/git/refs `),
    body: { ref: "refs/tags/start/v0.2.0" },
  });

  /** A stand-in for version-pr.sh: logs its arguments and REASON, or fails. */
  function stubVersionPr(failFor = ""): { env: Record<string, string>; log: string } {
    const dir = mkdtempSync(join(tmpdir(), "start-version-"));
    const log = join(dir, "version-pr.log");
    writeFileSync(log, "");
    const stub = join(dir, "version-pr.sh");
    writeFileSync(
      stub,
      `#!/bin/sh\nprintf '%s %s | %s | auto-merge=%s\\n' "$1" "$2" "$REASON" "$AUTO_MERGE" >> "${log}"\n[ "$1" != "${failFor}" ] || exit 1\necho "$1: opened chore: start $2"\n`,
    );
    return {
      env: { START_MESSAGE: "Started by the owner", VERSION_PR: stub },
      log,
    };
  }
  const prCalls = (log: string) =>
    readFileSync(log, "utf8").split("\n").filter(Boolean);

  test("pushes start/v<next minor> at each repo's trunk head, then opens its version PR", () => {
    const stub = stubVersionPr();
    const r = run(
      START,
      [
        repoTags("a", "v0.1.5", "v0.1.5-rc.2"),
        repoTags("b", "v0.1.3"),
        trunkHead("a"),
        trunkHead("b"),
        tagObject("a"),
        tagObject("b"),
        tagRef("a"),
        tagRef("b"),
      ],
      stub.env,
      ["minor", "o/a:publish-daemon-trunk.yml", "o/b"],
    );
    expect(r.status).toBe(0);
    expect(r.calls).toContain(
      `api --method POST repos/o/a/git/tags -f tag=start/v0.2.0 -f message=Started by the owner -f object=${HEAD} -f type=commit --jq .sha`,
    );
    expect(r.calls).toContain(
      `api --method POST repos/o/a/git/refs -f ref=refs/tags/start/v0.2.0 -f sha=${OTHER}`,
    );
    // The trunk build is no longer re-run: the canary check would refuse it.
    expect(r.calls.some((c) => c.startsWith("workflow run"))).toBe(false);
    expect(prCalls(stub.log)).toEqual([
      "o/a 0.2.0 | It was opened by Start Next Version, which started 0.2.0. | auto-merge=true",
      "o/b 0.2.0 | It was opened by Start Next Version, which started 0.2.0. | auto-merge=true",
    ]);
    expect(r.out).toContain(
      "o/a: started 0.2.0 (newest release 0.1.5): start/v0.2.0 at aaaaaaa",
    );
    expect(r.out).toContain("o/a: opened chore: start 0.2.0");
    expect(r.out).toContain("o/b: started 0.2.0 (newest release 0.1.3)");
  });

  test("a dry run names the marker and the PR it would open, and changes nothing", () => {
    const stub = stubVersionPr();
    const r = run(
      START,
      [repoTags("a", "v0.1.5"), trunkHead("a")],
      { ...stub.env, DRY_RUN: "true" },
      ["major", "o/a:build.yml"],
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain(
      'o/a: would start 1.0.0 (newest release 0.1.5, building 0.1.6 now): start/v1.0.0 at aaaaaaa, then open "chore: start 1.0.0" (version/1.0.0 into trunk) (dry run)',
    );
    expect(r.calls.some((c) => c.includes("--method POST"))).toBe(false);
    expect(prCalls(stub.log)).toEqual([]);
  });

  test("pressing it twice retries the version PR and pushes no second marker", () => {
    const stub = stubVersionPr();
    const r = run(START, [repoTags("a", "v0.1.5", "start/v0.2.0")], stub.env, [
      "minor",
      "o/a:build.yml",
    ]);
    expect(r.status).toBe(0);
    expect(r.out).toContain(
      'o/a: already building 0.2.0; making sure its "chore: start 0.2.0" PR is open',
    );
    expect(r.calls.some((c) => c.includes("--method POST"))).toBe(false);
    expect(prCalls(stub.log)).toEqual([
      "o/a 0.2.0 | It was opened by Start Next Version, which started 0.2.0. | auto-merge=true",
    ]);
  });

  test("a dry run on a repo already on the target names the PR check", () => {
    const stub = stubVersionPr();
    const r = run(
      START,
      [repoTags("a", "v0.1.5", "start/v0.2.0")],
      { ...stub.env, DRY_RUN: "true" },
      ["minor", "o/a"],
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain(
      'o/a: already building 0.2.0; would make sure "chore: start 0.2.0" (version/0.2.0 into trunk) is open or merged (dry run)',
    );
    expect(prCalls(stub.log)).toEqual([]);
  });

  test("a retried version PR that still cannot open fails the run", () => {
    const stub = stubVersionPr("o/a");
    const r = run(START, [repoTags("a", "v0.1.5", "start/v0.2.0")], stub.env, [
      "minor",
      "o/a",
    ]);
    expect(r.status).toBe(1);
    expect(r.out).toContain('its "chore: start 0.2.0" PR is not open');
  });

  test("a repo already building a later version is left alone", () => {
    const stub = stubVersionPr();
    const r = run(START, [repoTags("a", "v0.1.5", "start/v0.3.0")], stub.env, [
      "minor",
      "o/a:build.yml",
    ]);
    expect(r.status).toBe(0);
    expect(r.out).toContain(
      "o/a: already building 0.3.0, which is 0.2.0 or later; nothing to start",
    );
    expect(r.calls.some((c) => c.includes("--method POST"))).toBe(false);
    expect(prCalls(stub.log)).toEqual([]);
  });

  test("a version PR it cannot open fails the run with the manual step", () => {
    const stub = stubVersionPr("o/a");
    const r = run(
      START,
      [repoTags("a", "v0.1.5"), trunkHead("a"), tagObject("a"), tagRef("a")],
      stub.env,
      ["minor", "o/a:verify.yml"],
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      `::error::o/a: start/v0.2.0 is pushed but its "chore: start 0.2.0" PR is not open; canaries are refused until trunk's version files say 0.2.0: run node scripts/set-version.mjs 0.2.0 in a PR`,
    );
  });

  test("a repo that cannot be marked fails the run, after the others are done", () => {
    const stub = stubVersionPr();
    const r = run(
      START,
      [
        repoTags("a", "v0.1.5"),
        { match: /^api --paginate repos\/o\/b\//, exit: 1 },
        trunkHead("a"),
        tagObject("a"),
        { match: /^api --method POST repos\/o\/a\/git\/refs /, exit: 1 },
        repoTags("c", "v0.1.4"),
        trunkHead("c"),
        tagObject("c"),
        tagRef("c"),
      ],
      stub.env,
      ["minor", "o/a:x.yml", "o/b:y.yml", "o/c:z.yml"],
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("o/a: could not push start/v0.2.0");
    expect(r.out).toContain("o/b: could not list its tags");
    expect(r.out).toContain("o/c: started 0.2.0");
    expect(prCalls(stub.log)).toEqual([
      "o/c 0.2.0 | It was opened by Start Next Version, which started 0.2.0. | auto-merge=true",
    ]);
  });

  test("refuses anything but minor or major, and a malformed repo", () => {
    const { env } = stubVersionPr();
    const patch = run(START, [], env, ["patch", "o/a:x.yml"]);
    expect(patch.status).toBe(1);
    expect(patch.out).toContain("usage: start-version.sh <minor|major>");
    expect(run(START, [], env, ["minor"]).out).toContain(
      "name at least one <owner/repo>[:<workflow>]",
    );
    const bad = run(START, [], env, ["minor", "turbopanel"]);
    expect(bad.status).toBe(1);
    expect(bad.out).toContain("not <owner/repo>[:<workflow>]: 'turbopanel'");
  });
});

describe("version-pr.sh — the chore: start x.y.z PR", () => {
  const PR_URL = "https://github.com/o/r/pull/7";
  const COMMIT = "c".repeat(40);

  /** git with no user or system config (so no signing), for the fixture only. */
  function git(cwd: string, ...args: string[]): string {
    const r = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
    });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  }

  /**
   * A bare o/r.git whose trunk holds package.json at `version`, and a
   * set-version stand-in that rewrites it. GIT_BASE points the script at it.
   */
  function fixture(version = "0.1.5", withSetVersion = true) {
    const dir = mkdtempSync(join(tmpdir(), "version-pr-"));
    const src = join(dir, "src");
    git(dir, "init", "-q", "-b", "trunk", src);
    writeFileSync(
      join(src, "package.json"),
      `{\n  "name": "r",\n  "version": "${version}"\n}\n`,
    );
    writeFileSync(join(src, "README.md"), "r\n");
    git(src, "add", "-A");
    git(src, "commit", "-q", "-m", "init");
    const head = git(src, "rev-parse", "HEAD");
    git(dir, "clone", "-q", "--bare", src, join(dir, "o", "r.git"));
    const set = join(dir, "set.mjs");
    writeFileSync(
      set,
      `import { readFileSync, writeFileSync } from "node:fs";\nconst t = readFileSync("package.json", "utf8");\nwriteFileSync("package.json", t.replace(/"version": "[^"]*"/, '"version": "' + process.argv[2] + '"'));\n`,
    );
    const output = join(dir, "output");
    writeFileSync(output, "");
    const env: Record<string, string> = {
      GIT_BASE: `file://${dir}`,
      GITHUB_OUTPUT: output,
      GH_TOKEN: "fixture-token",
    };
    if (withSetVersion) env.SET_VERSION = `node ${set}`;
    return { head, env, output };
  }

  const noOpenPr: Route = { match: /^api repos\/o\/r\/pulls\?/, body: [] };
  const noBranch: Route = {
    match: /^api repos\/o\/r\/git\/ref\/heads\/version\//,
    exit: 1,
  };
  const createRef: Route = {
    match: /^api --method POST repos\/o\/r\/git\/refs /,
    body: {},
  };
  const commit: Route = {
    match: /^api graphql --input /,
    body: { data: { createCommitOnBranch: { commit: { oid: COMMIT } } } },
  };
  const openPr: Route = {
    match: /^api --method POST repos\/o\/r\/pulls /,
    body: { html_url: PR_URL },
  };
  const VPR = join(ROOT, "scripts", "promote", "version-pr.sh");

  test("opens the PR through createCommitOnBranch, with no author and trunk's head expected", () => {
    const f = fixture();
    const r = run(
      VPR,
      [noOpenPr, noBranch, createRef, commit, openPr],
      { ...f.env, REASON: "It was opened after v0.1.9 was released." },
      ["o/r", "0.2.0"],
    );
    expect(r.status).toBe(0);
    expect(r.calls).toContain(
      "api repos/o/r/pulls?state=open&base=trunk&head=o:version/0.2.0 --jq .[0].html_url // empty",
    );
    expect(r.calls).toContain(
      `api --method POST repos/o/r/git/refs -f ref=refs/heads/version/0.2.0 -f sha=${f.head}`,
    );
    expect(r.calls.some((c) => c.startsWith("api --method PATCH"))).toBe(false);
    const request = JSON.parse(r.sent[0] ?? "{}") as {
      query: string;
      variables: { input: Record<string, unknown> };
    };
    expect(request.query).toContain("createCommitOnBranch");
    const input = request.variables.input;
    expect(Object.keys(input).sort((a, b) => a.localeCompare(b))).toEqual([
      "branch",
      "expectedHeadOid",
      "fileChanges",
      "message",
    ]);
    expect(r.sent[0]).not.toMatch(/author|committer|signature/i);
    expect(input.branch).toEqual({
      repositoryNameWithOwner: "o/r",
      branchName: "version/0.2.0",
    });
    expect(input.expectedHeadOid).toBe(f.head);
    expect(input.message).toMatchObject({ headline: "chore: start 0.2.0" });
    const changes = input.fileChanges as {
      additions: { path: string; contents: string }[];
      deletions: unknown[];
    };
    expect(changes.deletions).toEqual([]);
    expect(changes.additions.map((a) => a.path)).toEqual(["package.json"]);
    expect(
      Buffer.from(changes.additions[0]?.contents ?? "", "base64").toString(),
    ).toBe('{\n  "name": "r",\n  "version": "0.2.0"\n}\n');
    expect(r.calls).toContainEqual(
      expect.stringMatching(
        /^api --method POST repos\/o\/r\/pulls -f title=chore: start 0\.2\.0 -f head=version\/0\.2\.0 -f base=trunk -F body=@/,
      ),
    );
    expect(r.sent[1]).toContain("It was opened after v0.1.9 was released.");
    expect(r.sent[1]).toContain("canary builds are refused");
    expect(r.sent[1]).toContain("- `package.json`");
    expect(r.out).toContain(
      `o/r: opened "chore: start 0.2.0" (package.json): ${PR_URL}`,
    );
    expect(readFileSync(f.output, "utf8")).toBe(`pr-url=${PR_URL}\n`);
    // Auto-merge is off unless asked for.
    expect(r.calls.some((c) => c.startsWith("pr merge"))).toBe(false);
    // The token never reaches argv.
    expect(r.calls.join("\n")).not.toContain("fixture-token");
  });

  test("a repo already at the version needs no PR and touches nothing on GitHub", () => {
    const f = fixture("0.2.0");
    const r = run(VPR, [], f.env, ["o/r", "0.2.0"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("o/r: already at 0.2.0 on trunk");
    expect(r.calls).toEqual([]);
    expect(readFileSync(f.output, "utf8")).toBe("pr-url=\n");
  });

  test("a PR already open is reported and nothing changes", () => {
    const f = fixture();
    const r = run(
      VPR,
      [{ match: /^api repos\/o\/r\/pulls\?/, body: [{ html_url: PR_URL }] }],
      f.env,
      ["o/r", "0.2.0"],
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain(`o/r: "chore: start 0.2.0" is already open: ${PR_URL}`);
    expect(r.calls.some((c) => /--method|graphql/.test(c))).toBe(false);
    expect(r.calls.some((c) => c.startsWith("pr merge"))).toBe(false);
    expect(readFileSync(f.output, "utf8")).toBe(`pr-url=${PR_URL}\n`);
  });

  const alreadyOpen: Route = {
    match: /^api repos\/o\/r\/pulls\?/,
    body: [{ html_url: PR_URL }],
  };
  const merge: Route = { match: /^pr merge /, body: {} };

  test("AUTO_MERGE=true turns on squash auto-merge for the new PR, titled by the PR", () => {
    const f = fixture();
    const r = run(
      VPR,
      [noOpenPr, noBranch, createRef, commit, openPr, merge],
      { ...f.env, AUTO_MERGE: "true" },
      ["o/r", "0.2.0"],
    );
    expect(r.status).toBe(0);
    const merges = r.calls.filter((c) => c.startsWith("pr merge"));
    expect(merges).toEqual([`pr merge ${PR_URL} --auto --squash`]);
    expect(r.out).toContain(
      `o/r: auto-merge is on for ${PR_URL}; it merges itself once its checks pass`,
    );
    expect(readFileSync(f.output, "utf8")).toBe(`pr-url=${PR_URL}\n`);
  });

  test("AUTO_MERGE=true also turns it on for a PR already open", () => {
    const f = fixture();
    const r = run(VPR, [alreadyOpen, merge], { ...f.env, AUTO_MERGE: "true" }, [
      "o/r",
      "0.2.0",
    ]);
    expect(r.status).toBe(0);
    expect(r.calls).toContain(`pr merge ${PR_URL} --auto --squash`);
    expect(r.calls.some((c) => /--method|graphql/.test(c))).toBe(false);
  });

  test("auto-merge GitHub refuses is a warning; the PR stays open and the run passes", () => {
    const f = fixture();
    const r = run(
      VPR,
      [
        alreadyOpen,
        { match: /^pr merge /, exit: 1, stderr: "auto-merge is not allowed" },
      ],
      { ...f.env, AUTO_MERGE: "true" },
      ["o/r", "0.2.0"],
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("auto-merge is not allowed");
    expect(r.out).toContain(
      `::warning::o/r: could not turn on auto-merge for ${PR_URL}; merge it by hand once its checks pass`,
    );
    expect(readFileSync(f.output, "utf8")).toBe(`pr-url=${PR_URL}\n`);
  });

  test("a dry run never turns on auto-merge", () => {
    const f = fixture();
    const r = run(
      VPR,
      [alreadyOpen, merge],
      { ...f.env, AUTO_MERGE: "true", DRY_RUN: "true" },
      ["o/r", "0.2.0"],
    );
    expect(r.status).toBe(0);
    expect(r.calls.some((c) => c.startsWith("pr merge"))).toBe(false);
  });

  test("a branch left over without a PR is reset to trunk's head", () => {
    const f = fixture();
    const r = run(
      VPR,
      [
        noOpenPr,
        {
          match: /^api repos\/o\/r\/git\/ref\/heads\/version\//,
          body: { object: { sha: OTHER } },
        },
        { match: /^api --method PATCH /, body: {} },
        commit,
        openPr,
      ],
      f.env,
      ["o/r", "0.2.0"],
    );
    expect(r.status).toBe(0);
    expect(r.calls).toContain(
      `api --method PATCH repos/o/r/git/refs/heads/version/0.2.0 -f sha=${f.head} -F force=true`,
    );
    expect(r.calls.some((c) => c.includes("POST repos/o/r/git/refs"))).toBe(
      false,
    );
  });

  test("a failed commit is an error and opens no PR", () => {
    const f = fixture();
    const r = run(
      VPR,
      [
        noOpenPr,
        noBranch,
        createRef,
        {
          match: /^api graphql /,
          exit: 1,
          stderr: "GraphQL: Expected branch to point to x",
        },
      ],
      f.env,
      ["o/r", "0.2.0"],
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("GraphQL: Expected branch to point to x");
    expect(r.out).toContain(
      "::error::o/r: createCommitOnBranch failed on version/0.2.0",
    );
    expect(r.calls.some((c) => c.includes("POST repos/o/r/pulls"))).toBe(false);
  });

  test("a PR it cannot open is an error that says the commit is on the branch", () => {
    const f = fixture();
    const r = run(
      VPR,
      [
        noOpenPr,
        noBranch,
        createRef,
        commit,
        { match: /^api --method POST repos\/o\/r\/pulls /, exit: 1 },
      ],
      f.env,
      ["o/r", "0.2.0"],
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      "::error::o/r: could not open the PR from version/0.2.0",
    );
  });

  test("a dry run reports the PR it would open and changes nothing", () => {
    const f = fixture();
    const r = run(VPR, [noOpenPr], { ...f.env, DRY_RUN: "true" }, [
      "o/r",
      "0.2.0",
    ]);
    expect(r.status).toBe(0);
    expect(r.out).toContain(
      'o/r: would open "chore: start 0.2.0" (version/0.2.0 at ',
    );
    expect(r.out).toContain("into trunk) changing package.json (dry run)");
    expect(r.calls.some((c) => /--method|graphql/.test(c))).toBe(false);
  });

  test("a trunk without scripts/set-version.mjs is a clear error", () => {
    const f = fixture("0.1.5", false);
    const r = run(VPR, [], f.env, ["o/r", "0.2.0"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      "::error::o/r: trunk has no scripts/set-version.mjs; merge the change that adds it first",
    );
  });

  test("a clone that fails is an error", () => {
    const f = fixture();
    const r = run(VPR, [], f.env, ["o/missing", "0.2.0"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("::error::o/missing: could not clone trunk");
  });

  test("refuses a malformed repo or version", () => {
    expect(run(VPR, [], {}, ["turbopanel", "0.2.0"]).out).toContain(
      "usage: version-pr.sh <owner/repo> <X.Y.Z> (got repo 'turbopanel')",
    );
    const rc = run(VPR, [], {}, ["o/r", "0.2.0-rc.1"]);
    expect(rc.status).toBe(1);
    expect(rc.out).toContain("(got version '0.2.0-rc.1')");
  });
});

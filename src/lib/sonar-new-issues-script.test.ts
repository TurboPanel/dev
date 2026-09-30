import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "sonar", "new-issues.sh");
const ACTION = join(
  ROOT,
  ".github",
  "actions",
  "sonar-new-issues",
  "action.yml",
);

// A fake curl. Every call appends its argv to FAKE_LOG, and whatever arrived on
// stdin to FAKE_STDIN. It answers qualitygates/project_status calls from the
// STATUS_* files and issues/search calls from the ISSUES_* files. Each <name>_CODES
// file holds one HTTP status per line, consumed in order (the last one repeats).
const FAKE_CURL = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_LOG"
cat >> "$FAKE_STDIN"
out=""
prev=""
url=""
for a in "$@"; do
  if [ "$prev" = "-o" ]; then out="$a"; fi
  prev="$a"
  url="$a"
done
case "$url" in
  *qualitygates/project_status*) kind=STATUS ;;
  *issues/search*) kind=ISSUES ;;
  *) kind=OTHER ;;
esac
codes="$FAKE_DIR/$kind.codes"
count="$FAKE_DIR/$kind.count"
n=$(( $(cat "$count" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$count"
code=$(sed -n "\${n}p" "$codes" 2>/dev/null)
[ -n "$code" ] || code=$(tail -n 1 "$codes" 2>/dev/null)
[ -n "$code" ] || code=200
cp "$FAKE_DIR/$kind.body" "$out" 2>/dev/null || : > "$out"
printf '%s' "$code"
`;

type Issue = {
  rule: string;
  severity?: string;
  component: string;
  line?: number;
  message: string;
  impacts?: { softwareQuality: string; severity: string }[];
};

type Setup = {
  statusCodes?: number[];
  statusBody?: unknown;
  issuesCodes?: number[];
  issues?: Issue[];
  total?: number;
  token?: string;
  args?: string[];
};

type Result = {
  status: number;
  out: string;
  log: string[];
  stdin: string;
  statusCalls: number;
  issuesCalls: number;
};

function calls(dir: string, kind: string): number {
  const file = join(dir, `${kind}.count`);
  return existsSync(file) ? Number(readFileSync(file, "utf8").trim()) : 0;
}

function run(setup: Setup): Result {
  const dir = mkdtempSync(join(tmpdir(), "sonar-new-issues-"));
  const curl = join(dir, "curl");
  writeFileSync(curl, FAKE_CURL);
  chmodSync(curl, 0o755);
  writeFileSync(
    join(dir, "STATUS.codes"),
    (setup.statusCodes ?? [200]).join("\n"),
  );
  writeFileSync(
    join(dir, "STATUS.body"),
    JSON.stringify(setup.statusBody ?? { projectStatus: { status: "OK" } }),
  );
  const issues = setup.issues ?? [];
  writeFileSync(
    join(dir, "ISSUES.codes"),
    (setup.issuesCodes ?? [200]).join("\n"),
  );
  writeFileSync(
    join(dir, "ISSUES.body"),
    JSON.stringify({ total: setup.total ?? issues.length, issues }),
  );
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    SONAR_CURL: curl,
    SONAR_ATTEMPTS: "3",
    SONAR_RETRY_SECONDS: "0",
    RUNNER_TEMP: dir,
    FAKE_DIR: dir,
    FAKE_LOG: join(dir, "log"),
    FAKE_STDIN: join(dir, "stdin"),
  };
  if (setup.token !== undefined) env.SONAR_TOKEN = setup.token;
  const r = spawnSync(
    "sh",
    [SCRIPT, ...(setup.args ?? ["turbopanel_ui", "91"])],
    {
      env,
      encoding: "utf8",
    },
  );
  const read = (f: string) =>
    existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : "";
  return {
    status: r.status ?? -1,
    out: r.stdout + r.stderr,
    log: read("log").split("\n").filter(Boolean),
    stdin: read("stdin"),
    statusCalls: calls(dir, "STATUS"),
    issuesCalls: calls(dir, "ISSUES"),
  };
}

const nestedTernary: Issue = {
  rule: "typescript:S3358",
  severity: "MAJOR",
  component:
    "turbopanel_ui:src/components/admin/updates/upgrade-build-block.tsx",
  line: 35,
  message:
    "Extract this nested ternary operation into an independent statement.",
};

describe("scripts/sonar/new-issues.sh (no new Sonar issues on a PR)", () => {
  test("passes a pull request with no new issues", () => {
    const r = run({});
    expect(r.status).toBe(0);
    expect(r.out).toContain(
      "No new Sonar issues on this pull request (turbopanel_ui #91).",
    );
    expect(r.out).not.toContain("::error");
  });

  test("asks for exactly this project and pull request, unresolved issues only", () => {
    const r = run({});
    expect(r.log.join("\n")).toContain(
      "https://sonarcloud.io/api/qualitygates/project_status?projectKey=turbopanel_ui&pullRequest=91",
    );
    expect(r.log.join("\n")).toContain(
      "https://sonarcloud.io/api/issues/search?componentKeys=turbopanel_ui&pullRequest=91&resolved=false&ps=100",
    );
  });

  test("fails on a single new code smell, annotated on its file and line", () => {
    const r = run({ issues: [nestedTernary] });
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      "::error file=src/components/admin/updates/upgrade-build-block.tsx,line=35,title=Sonar typescript%3AS3358 (MAJOR)::Extract this nested ternary operation into an independent statement.",
    );
    expect(r.out).toContain("1 new Sonar issue(s) on this pull request");
    expect(r.out).toContain(
      "https://sonarcloud.io/project/issues?id=turbopanel_ui&pullRequest=91&resolved=false",
    );
  });

  test("escapes workflow-command characters in the message and the properties", () => {
    const r = run({
      issues: [
        {
          rule: "typescript:S1",
          severity: "MINOR",
          component: "turbopanel_ui:src/a,b.ts",
          message: "100% sure\nsecond line",
        },
      ],
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      "::error file=src/a%2Cb.ts,title=Sonar typescript%3AS1 (MINOR)::100%25 sure%0Asecond line",
    );
  });

  test("falls back to the impact severity when the legacy severity is absent", () => {
    const r = run({
      issues: [
        {
          rule: "typescript:S2",
          component: "turbopanel_ui:src/x.ts",
          line: 1,
          message: "m",
          impacts: [{ softwareQuality: "MAINTAINABILITY", severity: "LOW" }],
        },
      ],
    });
    expect(r.out).toContain("title=Sonar typescript%3AS2 (LOW)");
  });

  test("says how many more issues the page did not show", () => {
    const r = run({ issues: [nestedTernary], total: 130 });
    expect(r.status).toBe(1);
    expect(r.out).toContain("...and 129 more; see the dashboard.");
  });

  test("retries while the analysis is not there yet, then checks the issues", () => {
    const r = run({ statusCodes: [404, 200] });
    expect(r.status).toBe(0);
    expect(r.statusCalls).toBe(2);
    expect(r.issuesCalls).toBe(1);
  });

  test("fails closed when SonarCloud never has an analysis for the pull request", () => {
    const r = run({ statusCodes: [404] });
    expect(r.status).toBe(1);
    expect(r.statusCalls).toBe(3);
    expect(r.issuesCalls).toBe(0);
    expect(r.out).toContain(
      "SonarCloud has no analysis for turbopanel_ui pull request 91 (last HTTP status 404)",
    );
  });

  test("fails closed when a 200 carries no analysis status", () => {
    const r = run({ statusBody: { errors: [{ msg: "nope" }] } });
    expect(r.status).toBe(1);
    expect(r.out).toContain("SonarCloud has no analysis");
  });

  test("fails closed when the issues endpoint keeps erroring", () => {
    const r = run({ issuesCodes: [500] });
    expect(r.status).toBe(1);
    expect(r.issuesCalls).toBe(3);
    expect(r.out).toContain(
      "Could not read the Sonar issues for turbopanel_ui pull request 91 (last HTTP status 500)",
    );
  });

  test("sends SONAR_TOKEN through a curl config on stdin, never in argv", () => {
    const secret = ["tok", "en", "-", String(Date.now())].join("");
    const r = run({ token: secret });
    expect(r.status).toBe(0);
    expect(r.log.join("\n")).not.toContain(secret);
    expect(r.log.join("\n")).toContain("-K -");
    expect(r.stdin).toContain(`header = "Authorization: Bearer ${secret}"`);
  });

  test("sends no auth header without a token", () => {
    const r = run({});
    expect(r.log.join("\n")).not.toContain("-K");
    expect(r.stdin).toBe("");
  });

  test("refuses a missing project key or pull request number", () => {
    const r = run({ args: ["turbopanel_ui"] });
    expect(r.status).toBe(2);
    expect(r.out).toContain(
      "usage: new-issues.sh <project-key> <pull-request-number>",
    );
    expect(r.log).toEqual([]);
  });

  test("refuses a pull request number that is not digits", () => {
    const r = run({ args: ["turbopanel_ui", "91&x=1"] });
    expect(r.status).toBe(2);
    expect(r.out).toContain("pull request number must be digits");
    expect(r.log).toEqual([]);
  });
});

describe(".github/actions/sonar-new-issues", () => {
  const action = readFileSync(ACTION, "utf8");

  test("runs new-issues.sh from the same dev commit with the PR number", () => {
    expect(action).toContain(
      'sh "$GITHUB_ACTION_PATH/../../../scripts/sonar/new-issues.sh" "$key" "$PR_NUMBER"',
    );
    expect(action).toContain(
      "PR_NUMBER: ${{ github.event.pull_request.number }}",
    );
  });

  test("defaults the project key to sonar-project.properties", () => {
    expect(action).toContain(
      "sed -n 's/^sonar\\.projectKey=//p' sonar-project.properties",
    );
  });
});

import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCAN = join(ROOT, "scripts", "osv", "scan.sh");
const ACTION = join(ROOT, ".github", "actions", "osv-scan", "action.yml");

// A fake osv-scanner: writes FAKE_REPORT to the --output-file argument (when
// set) and exits FAKE_EXIT, recording its arguments in FAKE_ARGS.
const FAKE_SCANNER = `#!/bin/sh
printf '%s\\n' "$*" > "$FAKE_ARGS"
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--output-file" ]; then out="$a"; fi
  prev="$a"
done
if [ -n "\${FAKE_REPORT:-}" ]; then cp "$FAKE_REPORT" "$out"; fi
exit "\${FAKE_EXIT:-0}"
`;

type Event = { introduced?: string; fixed?: string; last_affected?: string };
type Advisory = {
  id: string;
  label?: string;
  affected?: { name: string; events: Event[] }[];
};
type Finding = {
  name: string;
  version: string;
  maxSeverity: string;
  advisories: Advisory[];
};

// The shape osv-scanner v2.6.0 writes with --format json (trimmed to the
// fields the gate reads).
function report(findings: Finding[]) {
  return {
    results: findings.length
      ? [
          {
            source: { path: "/repo/pnpm-lock.yaml", type: "lockfile" },
            packages: findings.map((f) => ({
              package: { name: f.name, version: f.version, ecosystem: "npm" },
              groups: [
                {
                  ids: f.advisories.map((a) => a.id),
                  aliases: f.advisories.map((a) => a.id),
                  max_severity: f.maxSeverity,
                },
              ],
              vulnerabilities: f.advisories.map((a) => ({
                id: a.id,
                ...(a.label
                  ? { database_specific: { severity: a.label } }
                  : {}),
                affected: (a.affected ?? []).map((x) => ({
                  package: { name: x.name, ecosystem: "npm" },
                  ranges: [{ type: "SEMVER", events: x.events }],
                })),
              })),
            })),
          },
        ]
      : [],
  };
}

type Result = { status: number; out: string; args: string };

function run(opts: { report?: unknown; scannerExit: number }): Result {
  const dir = mkdtempSync(join(tmpdir(), "osv-scan-"));
  const scanner = join(dir, "osv-scanner");
  writeFileSync(scanner, FAKE_SCANNER);
  chmodSync(scanner, 0o755);
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    OSV_SCANNER: scanner,
    OSV_REPORT: join(dir, "report.json"),
    FAKE_ARGS: join(dir, "args"),
    FAKE_EXIT: String(opts.scannerExit),
  };
  if (opts.report !== undefined) {
    const reportFile = join(dir, "fixture.json");
    writeFileSync(reportFile, JSON.stringify(opts.report));
    env.FAKE_REPORT = reportFile;
  }
  const r = spawnSync("sh", [SCAN, "some/dir"], { env, encoding: "utf8" });
  return {
    status: r.status ?? -1,
    out: r.stdout + r.stderr,
    args: readFileSync(env.FAKE_ARGS, "utf8").trim(),
  };
}

const fixedAt = (name: string, version: string) => [
  { name, events: [{ introduced: "0" }, { fixed: version }] },
];

describe("scripts/osv/scan.sh (dependency advisory gate)", () => {
  test("scans the given directory recursively into a JSON report", () => {
    const r = run({ report: report([]), scannerExit: 0 });
    expect(r.args).toMatch(
      /^scan source --recursive --format json --output-file \S+report\.json some\/dir$/,
    );
  });

  test("passes a clean scan", () => {
    const r = run({ report: report([]), scannerExit: 0 });
    expect(r.status).toBe(0);
    expect(r.out).toContain("Dependency advisories: 0 found, 0 blocking.");
    expect(r.out).not.toContain("::");
  });

  test("blocks a HIGH advisory that has a fixed version", () => {
    const r = run({
      scannerExit: 1,
      report: report([
        {
          name: "image-size",
          version: "1.2.1",
          maxSeverity: "8.7",
          advisories: [
            {
              id: "GHSA-5p2g-fcmc-qvqq",
              label: "HIGH",
              affected: fixedAt("image-size", "1.2.2"),
            },
          ],
        },
      ]),
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      "::error title=Dependency advisory (blocking)::image-size@1.2.1 GHSA-5p2g-fcmc-qvqq, severity 8.7 HIGH, fix available.",
    );
    expect(r.out).toContain("1 found, 1 blocking.");
  });

  test("only warns on a LOW advisory, even with a fix", () => {
    const r = run({
      scannerExit: 1,
      report: report([
        {
          name: "dompurify",
          version: "3.4.15",
          maxSeverity: "2.3",
          advisories: [
            {
              id: "GHSA-p98j-92pf-mc4p",
              label: "LOW",
              affected: fixedAt("dompurify", "3.4.16"),
            },
          ],
        },
      ]),
    });
    expect(r.status).toBe(0);
    expect(r.out).toContain(
      "::warning title=Dependency advisory::dompurify@3.4.15 GHSA-p98j-92pf-mc4p, severity 2.3 LOW, fix available.",
    );
  });

  test("only warns on a CRITICAL advisory with no fixed version yet", () => {
    const r = run({
      scannerExit: 1,
      report: report([
        {
          name: "left-pad",
          version: "1.0.0",
          maxSeverity: "9.8",
          advisories: [
            {
              id: "GHSA-aaaa-bbbb-cccc",
              label: "CRITICAL",
              affected: [
                {
                  name: "left-pad",
                  events: [{ introduced: "0" }, { last_affected: "1.0.0" }],
                },
              ],
            },
          ],
        },
      ]),
    });
    expect(r.status).toBe(0);
    expect(r.out).toContain("severity 9.8 CRITICAL, no fix yet.");
  });

  test("a fixed version for a different package does not count", () => {
    const r = run({
      scannerExit: 1,
      report: report([
        {
          name: "@vitest/mocker",
          version: "3.2.7",
          maxSeverity: "7.5",
          advisories: [
            {
              id: "GHSA-dddd-eeee-ffff",
              label: "HIGH",
              affected: fixedAt("vitest", "4.1.11"),
            },
          ],
        },
      ]),
    });
    expect(r.status).toBe(0);
    expect(r.out).toContain("no fix yet");
  });

  test("a CVSS score of 7 or more blocks even when the database says MODERATE", () => {
    const r = run({
      scannerExit: 1,
      report: report([
        {
          name: "undici",
          version: "7.29.0",
          maxSeverity: "7.0",
          advisories: [
            {
              id: "GHSA-3wwx-pv8p-q78v",
              label: "MODERATE",
              affected: fixedAt("undici", "7.29.1"),
            },
          ],
        },
      ]),
    });
    expect(r.status).toBe(1);
  });

  test("a HIGH database label blocks when osv-scanner has no score", () => {
    const r = run({
      scannerExit: 1,
      report: report([
        {
          name: "nodemailer",
          version: "10.0.1",
          maxSeverity: "",
          advisories: [
            {
              id: "GHSA-6vj9-mwq6-2f5v",
              label: "high",
              affected: fixedAt("nodemailer", "10.0.2"),
            },
          ],
        },
      ]),
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain("severity ? HIGH, fix available.");
  });

  test("an unrated advisory only warns", () => {
    const r = run({
      scannerExit: 1,
      report: report([
        {
          name: "some-pkg",
          version: "1.0.0",
          maxSeverity: "",
          advisories: [
            { id: "OSV-2026-1", affected: fixedAt("some-pkg", "1.0.1") },
          ],
        },
      ]),
    });
    expect(r.status).toBe(0);
    expect(r.out).toContain("severity ? unrated, fix available.");
  });

  test("reports every finding and fails when any one blocks", () => {
    const r = run({
      scannerExit: 1,
      report: report([
        {
          name: "dompurify",
          version: "3.4.15",
          maxSeverity: "2.3",
          advisories: [
            {
              id: "GHSA-p98j-92pf-mc4p",
              label: "LOW",
              affected: fixedAt("dompurify", "3.4.16"),
            },
          ],
        },
        {
          name: "image-size",
          version: "1.2.1",
          maxSeverity: "8.7",
          advisories: [
            {
              id: "GHSA-5p2g-fcmc-qvqq",
              label: "HIGH",
              affected: fixedAt("image-size", "1.2.2"),
            },
          ],
        },
      ]),
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain("::warning title=Dependency advisory::dompurify");
    expect(r.out).toContain(
      "::error title=Dependency advisory (blocking)::image-size",
    );
    expect(r.out).toContain("2 found, 1 blocking.");
  });

  test("a scanner error fails with the scanner's own exit code and no verdict", () => {
    const r = run({ scannerExit: 127 });
    expect(r.status).toBe(127);
    expect(r.out).toContain("osv-scanner failed (exit 127); no verdict");
    expect(r.out).not.toContain("Dependency advisories:");
  });
});

describe(".github/actions/osv-scan", () => {
  const action = readFileSync(ACTION, "utf8");

  test("installs the pinned, checksum-verified osv-scanner", () => {
    expect(action).toContain(
      "https://github.com/google/osv-scanner/releases/download/v2.6.0/osv-scanner_linux_amd64",
    );
    expect(action).toMatch(
      /echo "[\da-f]{64} {2}\/usr\/local\/bin\/osv-scanner" \| sha256sum -c -/,
    );
  });

  test("runs scan.sh from the same dev commit", () => {
    expect(action).toContain(
      'run: sh "$GITHUB_ACTION_PATH/../../../scripts/osv/scan.sh" "$SCAN_PATH"',
    );
  });
});

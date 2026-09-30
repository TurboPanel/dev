import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// The prune step of .github/workflows/gh-canary.yml, run for real: its Python
// is lifted out of the workflow and run against a stub `gh` that answers
// `release view` with a fixed asset list and records every `delete-asset`.
// The fixture holds the real asset names of the three rolling canary releases.

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = join(HERE, "../../.github/workflows/gh-canary.yml");
const FIXTURE = JSON.parse(
  readFileSync(join(HERE, "gh-canary-prune.fixture.json"), "utf8"),
) as {
  assets: Record<"turbopaneld" | "turbopanel" | "ui", string[]>;
};

/** The prune step's heredoc, dedented back to plain Python. */
function pruneScript(): string {
  const text = readFileSync(WORKFLOW, "utf8");
  const step = text.indexOf("- name: Prune builds older than the newest");
  if (step < 0) throw new Error("gh-canary.yml has no prune step");
  const open = "python3 <<'PY'\n";
  const start = text.indexOf(open, step) + open.length;
  const end = text.indexOf("\n          PY\n", start);
  return text
    .slice(start, end)
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
}

type PruneResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  deleted: string[];
};

let workdir: string | null = null;
afterEach(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
  workdir = null;
});

function prune(
  names: string[],
  options: {
    keep: number;
    current: string;
    manifest?: string;
    failDelete?: boolean;
  },
): PruneResult {
  workdir = mkdtempSync(join(tmpdir(), "gh-canary-prune-"));
  const bin = join(workdir, "bin");
  mkdirSync(bin);
  const assetsJson = join(workdir, "assets.json");
  const deletedLog = join(workdir, "deleted");
  writeFileSync(
    assetsJson,
    JSON.stringify({ assets: names.map((name) => ({ name })) }),
  );
  const script = join(workdir, "prune.py");
  writeFileSync(script, pruneScript());
  const stub = join(bin, "gh");
  writeFileSync(
    stub,
    [
      "#!/usr/bin/env sh",
      'case "$1 $2" in',
      '  "release view") cat "$ASSETS_JSON" ;;',
      '  "release delete-asset") [ -z "$FAIL_DELETE" ] || exit 1; printf "%s\\n" "$4" >> "$DELETED_LOG" ;;',
      '  *) echo "unexpected gh $*" >&2; exit 1 ;;',
      "esac",
    ].join("\n") + "\n",
  );
  chmodSync(stub, 0o755);
  const res = spawnSync("python3", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      ASSETS_JSON: assetsJson,
      DELETED_LOG: deletedLog,
      REPO: "TurboPanel/example",
      TAG: "canary",
      KEEP: String(options.keep),
      MANIFEST_NAME: options.manifest ?? "manifest.json",
      CURRENT_VERSION: options.current,
      FAIL_DELETE: options.failDelete ? "1" : "",
    },
  });
  const deleted = existsSync(deletedLog)
    ? readFileSync(deletedLog, "utf8").split("\n").filter(Boolean)
    : [];
  return {
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    deleted,
  };
}

/** Every name that belongs to one of `builds` (`<X.Y.Z>-canary.<id>`). */
function filesOf(names: string[], builds: string[]): string[] {
  return names.filter((name) =>
    builds.some(
      (build) => name.includes(`-${build}-`) || name.includes(`-${build}.`),
    ),
  );
}

const sorted = (list: string[]) => [...list].sort((a, b) => a.localeCompare(b));

/** The timestamped builds (`<X.Y.Z>-canary.<yyyymmdd>-<hhmmss>-<sha7>`) among `names`. */
function timestampBuilds(names: string[]): string[] {
  const builds = new Set<string>();
  for (const name of names) {
    const [head, tail] = name.split("-canary.");
    const id = tail?.slice(0, 23) ?? "";
    if (/^\d{8}-\d{6}-[0-9a-f]{7}$/.test(id)) {
      builds.add(`${head.slice(head.lastIndexOf("-") + 1)}-canary.${id}`);
    }
  }
  return [...builds];
}

const counterRange = (version: string, from: number, to: number) =>
  Array.from(
    { length: to - from + 1 },
    (_, i) => `${version}-canary.${from + i}`,
  );

describe("gh-canary.yml prune step on the real rolling releases (keep=20)", () => {
  it("turbopaneld: prunes every timestamped build and the 7 oldest counter builds, tarballs included", () => {
    const names = FIXTURE.assets.turbopaneld;
    const stale = [
      ...timestampBuilds(names),
      ...counterRange("0.1.3", 416, 420),
      ...counterRange("0.1.4", 421, 422),
    ];
    expect(timestampBuilds(names)).toHaveLength(20);
    const res = prune(names, { keep: 20, current: "0.1.5-canary.446" });
    expect(res.status).toBe(0);
    expect(sorted(res.deleted)).toEqual(sorted(filesOf(names, stale)));
    expect(res.deleted).toHaveLength(135);
    expect(res.deleted).toContain(
      "turbopaneld-0.1.1-canary.20260927-042003-5cfdc17-amd64.tar.zst",
    );
    expect(res.deleted).toContain("turbopaneld.js-0.1.4-canary.422.tar.zst");
    expect(res.deleted).toContain("orchestration-0.1.3-canary.416.tar.zst");
    expect(res.deleted).not.toContain("manifest.json");
    expect(res.deleted).not.toContain(
      "turbopaneld-0.1.4-canary.423-arm64.tar.zst",
    );
    expect(res.stdout).not.toContain("::notice::");
    expect(res.stdout).toContain("kept 20 build(s), pruned 27 (135 file(s))");
  });

  it("turbopanel: prunes the timestamped builds and the 8 oldest counters, whose manifests are already gone", () => {
    const names = FIXTURE.assets.turbopanel;
    const orphans = counterRange("0.1.3", 71, 78);
    for (const build of orphans)
      expect(names).not.toContain(`manifest-${build}.json`);
    const stale = [...timestampBuilds(names), ...orphans];
    const res = prune(names, { keep: 20, current: "0.1.4-canary.119" });
    expect(res.status).toBe(0);
    expect(sorted(res.deleted)).toEqual(sorted(filesOf(names, stale)));
    expect(res.deleted).toHaveLength(56);
    expect(res.deleted).toContain(
      "turbopanel-instance-0.1.1-canary.20260927-025523-5c994cd-linux-arm64.tar.zst",
    );
    expect(res.deleted).toContain(
      "turbopanel-instance-0.1.3-canary.78-linux-amd64.tar.zst",
    );
    expect(res.deleted).not.toContain(
      "turbopanel-instance-0.1.3-canary.100-linux-amd64.tar.zst",
    );
    expect(res.deleted).not.toContain("manifest-0.1.3-canary.79.json");
  });

  it("ui: 20 builds, nothing to prune", () => {
    const res = prune(FIXTURE.assets.ui, {
      keep: 20,
      current: "0.1.3-canary.94",
    });
    expect(res.status).toBe(0);
    expect(res.deleted).toEqual([]);
    expect(res.stdout).toContain(
      "20 build(s) on the rolling release, keep=20: nothing to prune",
    );
  });
});

describe("gh-canary.yml prune step", () => {
  const ts = (id: string) => [
    `turbopanel-instance-0.1.1-canary.${id}-linux-amd64.tar.zst`,
    `turbopanel-instance-0.1.1-canary.${id}-linux-arm64.tar.zst`,
    `manifest-0.1.1-canary.${id}.json`,
  ];

  it("keeps a timestamp id whole: two builds of the same day are two builds", () => {
    const older = ts("20260927-025523-5c994cd");
    const newer = ts("20260927-033604-18ad2b0");
    const res = prune([...older, ...newer, "manifest.json"], {
      keep: 1,
      current: "0.1.1-canary.20260927-033604-18ad2b0",
    });
    expect(sorted(res.deleted)).toEqual(sorted(older));
  });

  it("orders counters numerically and after every timestamped build", () => {
    const names = [
      "turbopaneld-0.1.3-canary.9-amd64.tar.zst",
      "manifest-0.1.3-canary.9.json",
      "turbopaneld-0.1.3-canary.10-amd64.tar.zst",
      "manifest-0.1.3-canary.10.json",
      ...ts("20991231-235959-abcdef0"),
      "manifest.json",
    ];
    const res = prune(names, { keep: 1, current: "0.1.3-canary.10" });
    expect(sorted(res.deleted)).toEqual(
      sorted([
        "turbopaneld-0.1.3-canary.9-amd64.tar.zst",
        "manifest-0.1.3-canary.9.json",
        ...ts("20991231-235959-abcdef0"),
      ]),
    );
  });

  it("keeps builds of different versions apart even when their counters match", () => {
    const names = [
      "turbopanel-ui-0.1.4-canary.5.tar.gz",
      "manifest-0.1.4-canary.5.json",
      "turbopanel-ui-0.1.5-canary.5.tar.gz",
      "manifest-0.1.5-canary.5.json",
    ];
    const res = prune(names, { keep: 1, current: "0.1.5-canary.5" });
    expect(sorted(res.deleted)).toEqual(
      sorted([
        "turbopanel-ui-0.1.4-canary.5.tar.gz",
        "manifest-0.1.4-canary.5.json",
      ]),
    );
  });

  it("prunes a build that has files but no manifest by its age", () => {
    const names = [
      "turbopaneld-0.1.3-canary.1-amd64.tar.zst",
      "turbopaneld-0.1.3-canary.1-arm64.tar.zst",
      "turbopaneld-0.1.3-canary.2-amd64.tar.zst",
      "manifest-0.1.3-canary.2.json",
    ];
    const res = prune(names, { keep: 1, current: "0.1.3-canary.2" });
    expect(sorted(res.deleted)).toEqual(
      sorted([
        "turbopaneld-0.1.3-canary.1-amd64.tar.zst",
        "turbopaneld-0.1.3-canary.1-arm64.tar.zst",
      ]),
    );
  });

  it("never prunes the rolling manifest or the build just published", () => {
    const names = [
      "manifest.json",
      "turbopanel-ui-0.1.3-canary.94.tar.gz",
      "manifest-0.1.3-canary.94.json",
      "turbopanel-ui-0.1.3-canary.92.tar.gz",
    ];
    const res = prune(names, { keep: 0, current: "0.1.3-canary.94" });
    expect(res.deleted).toEqual(["turbopanel-ui-0.1.3-canary.92.tar.gz"]);
  });

  it("honours a custom rolling manifest name", () => {
    const names = [
      "channel.json",
      "turbopanel-ui-0.1.3-canary.1.tar.gz",
      "turbopanel-ui-0.1.3-canary.2.tar.gz",
    ];
    const res = prune(names, {
      keep: 1,
      current: "0.1.3-canary.2",
      manifest: "channel.json",
    });
    expect(res.deleted).toEqual(["turbopanel-ui-0.1.3-canary.1.tar.gz"]);
    expect(res.stdout).not.toContain("::notice::");
  });

  it("leaves unrecognised assets alone and reports them in one summary line", () => {
    const names = [
      "README.txt",
      "install.sh",
      "turbopanel-ui-0.1.3-canary.416x.tar.gz",
      "turbopanel-ui-0.1.3-canary.2.tar.gz",
    ];
    const res = prune(names, { keep: 1, current: "0.1.3-canary.2" });
    expect(res.deleted).toEqual([]);
    const notices = res.stdout
      .split("\n")
      .filter((line) => line.startsWith("::"));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/^::notice::3 asset\(s\) carry no/);
    expect(notices[0]).toContain("README.txt");
  });

  it("shortens the summary line past ten unrecognised assets", () => {
    const names = Array.from(
      { length: 12 },
      (_, i) => `extra-${String(i).padStart(2, "0")}.txt`,
    );
    const res = prune(names, { keep: 20, current: "0.1.3-canary.1" });
    expect(res.stdout).toContain("::notice::12 asset(s)");
    expect(res.stdout).toContain("(+2 more)");
    expect(res.stdout).not.toContain("extra-11.txt");
  });

  it("prints each pruned file and fails the step when a delete fails", () => {
    const names = [
      "turbopanel-ui-0.1.3-canary.1.tar.gz",
      "turbopanel-ui-0.1.3-canary.2.tar.gz",
    ];
    const ok = prune(names, { keep: 1, current: "0.1.3-canary.2" });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("pruned turbopanel-ui-0.1.3-canary.1.tar.gz");
    const failed = prune(names, {
      keep: 1,
      current: "0.1.3-canary.2",
      failDelete: true,
    });
    expect(failed.status).not.toBe(0);
    expect(failed.stdout).not.toContain("pruned ");
  });
});

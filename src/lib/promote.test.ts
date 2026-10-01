import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  nextRcNumber,
  artifactMismatches,
  assertRepoKind,
  assertTarget,
  BRANCH_FOR_TARGET,
  compareVersions,
  findCanaryManifestAsset,
  hasAssets,
  latestRelease,
  newestUnreleasedRc,
  nextBase,
  nextCanaryNumber,
  nextPatch,
  outputLines,
  parseSource,
  pendingChangesetCount,
  releaseNotes,
  rewriteManifest,
  startTarget,
  targetVersion,
  walkArtifactEntries,
} from "../../scripts/promote/lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../..");
const WORKFLOWS = join(REPO_ROOT, ".github/workflows");

const BUILD_ID = "20260926-101530-abc1234";
const CANARY = `0.1.2-canary.${BUILD_ID}`;

function daemonManifest(version: string, base: string) {
  return {
    schema: 1,
    channel: "canary",
    commit: "0123456789abcdef0123456789abcdef01234567",
    buildId: BUILD_ID,
    builtAt: "2026-09-26T10:15:30Z",
    version,
    defaultControlPlaneUrl: "https://testing.turbopanel.io",
    binaryArtifacts: {
      "linux-amd64": {
        url: `${base}/turbopaneld-${version}-amd64.tar.zst`,
        sha256: "a".repeat(64),
        size: 10,
      },
      "linux-arm64": {
        url: `${base}/turbopaneld-${version}-arm64.tar.zst`,
        sha256: "b".repeat(64),
        size: 11,
      },
    },
    jsFallbackArtifact: {
      url: `${base}/turbopaneld.js-${version}.tar.zst`,
      sha256: "c".repeat(64),
      size: 12,
    },
    orchestrationArtifact: {
      url: `${base}/orchestration-${version}.tar.zst`,
      sha256: "d".repeat(64),
      size: 13,
    },
    signature: { alg: "ed25519", keyId: "c72c6744", value: "AAAA" },
  };
}

describe("targetVersion", () => {
  test("rc strips the canary label and appends -rc.1 when none exists", () => {
    expect(targetVersion("rc", CANARY)).toBe("0.1.2-rc.1");
  });

  test("rc strips a counter canary label too (0.1.3-canary.412 becomes 0.1.3-rc.1)", () => {
    expect(targetVersion("rc", "0.1.3-canary.412")).toBe("0.1.3-rc.1");
  });

  test("rc accepts a bare version (notes-only repos have no canary)", () => {
    expect(targetVersion("rc", "0.1.2")).toBe("0.1.2-rc.1");
  });

  test("rc numbers itself one past the highest existing rc tag for that number", () => {
    const tags = ["v0.1.3-rc.1", "refs/tags/v0.1.3-rc.2", "v0.1.2-rc.9"];
    expect(targetVersion("rc", "0.1.3-canary.412", tags)).toBe("0.1.3-rc.3");
    expect(targetVersion("rc", "0.1.4-canary.500", tags)).toBe("0.1.4-rc.1");
  });

  test("rc refuses any other pre-release label — an rc is never cut from an rc", () => {
    expect(() => targetVersion("rc", "0.1.2-rc.1")).toThrow(
      /canary build or a bare/,
    );
    expect(() => targetVersion("rc", "0.1.2-beta.1")).toThrow(
      /canary build or a bare/,
    );
    expect(() => targetVersion("rc", "")).toThrow(/empty/);
  });

  test("release strips -rc.N", () => {
    expect(targetVersion("release", "0.1.3-rc.2")).toBe("0.1.3");
    expect(targetVersion("release", "0.1.2-rc.1")).toBe("0.1.2");
    expect(targetVersion("release", "0.1.3-rc.12")).toBe("0.1.3");
  });

  test("release refuses canaries, bare versions and a label-less rc", () => {
    expect(() => targetVersion("release", CANARY)).toThrow(/rc pre-release/);
    expect(() => targetVersion("release", "0.1.2")).toThrow(/rc pre-release/);
    expect(() => targetVersion("release", "0.1.2-rc")).toThrow(
      /rc pre-release/,
    );
    expect(() => targetVersion("release", "x-rc.1")).toThrow(/bare X\.Y\.Z/);
  });

  test("unknown targets are rejected up front", () => {
    expect(() => targetVersion("prod", "0.1.2")).toThrow(/rc\|release/);
    expect(() => assertTarget("canary")).toThrow(/rc\|release/);
    expect(assertTarget("rc")).toBe("rc");
  });
});

describe("parseSource", () => {
  test("rc: a canary build id", () => {
    expect(parseSource("rc", ` ${BUILD_ID} `)).toEqual({
      kind: "canary-build-id",
      buildId: BUILD_ID,
    });
  });

  test("rc: a canary run number (the counter build id)", () => {
    expect(parseSource("rc", " 412 ")).toEqual({
      kind: "canary-build-id",
      buildId: "412",
    });
  });

  test("rc: a counter canary version or its manifest copy resolve to the same asset", () => {
    const expected = {
      kind: "canary-version",
      version: "0.1.3-canary.412",
      buildId: "412",
      asset: "manifest-0.1.3-canary.412.json",
    };
    expect(parseSource("rc", "0.1.3-canary.412")).toEqual(expected);
    expect(parseSource("rc", "manifest-0.1.3-canary.412.json")).toEqual(
      expected,
    );
  });

  test("rc: a canary version or its manifest copy resolve to the same asset", () => {
    const expected = {
      kind: "canary-version",
      version: CANARY,
      buildId: BUILD_ID,
      asset: `manifest-${CANARY}.json`,
    };
    expect(parseSource("rc", CANARY)).toEqual(expected);
    expect(parseSource("rc", `manifest-${CANARY}.json`)).toEqual(expected);
  });

  test("rc: anything else is refused with the accepted forms", () => {
    expect(() => parseSource("rc", "0.1.2")).toThrow(/canary build number/);
    expect(() => parseSource("rc", "manifest-0.1.2.json")).toThrow(
      /not a canary manifest copy/,
    );
    expect(() => parseSource("rc", "")).toThrow(/empty/);
  });

  test("release: the rc tag with or without the v", () => {
    expect(parseSource("release", "v0.1.2-rc.1")).toEqual({
      kind: "rc-tag",
      version: "0.1.2-rc.1",
      tag: "v0.1.2-rc.1",
    });
    expect(parseSource("release", "0.1.2-rc.1")).toEqual({
      kind: "rc-tag",
      version: "0.1.2-rc.1",
      tag: "v0.1.2-rc.1",
    });
  });

  test("release: a later rc number and a label-less rc", () => {
    expect(parseSource("release", "v0.1.3-rc.12")).toEqual({
      kind: "rc-tag",
      version: "0.1.3-rc.12",
      tag: "v0.1.3-rc.12",
    });
    expect(() => parseSource("release", "v0.1.3-rc")).toThrow(/rc tag/);
  });

  test("release: a canary or bare version is not an rc tag", () => {
    expect(() => parseSource("release", CANARY)).toThrow(/rc tag/);
    expect(() => parseSource("release", "v0.1.2")).toThrow(/rc tag/);
  });
});

describe("findCanaryManifestAsset", () => {
  const assets = [
    "manifest.json",
    `manifest-0.1.1-canary.20260925-020446-bfa1dc2.json`,
    `manifest-${CANARY}.json`,
    `turbopaneld-${CANARY}-amd64.tar.zst`,
  ];

  test("picks the one manifest copy for a build id", () => {
    expect(findCanaryManifestAsset(assets, BUILD_ID)).toBe(
      `manifest-${CANARY}.json`,
    );
  });

  test("a counter build matches only its own copy, never one whose number merely ends the same", () => {
    const counters = [
      "manifest-0.1.3-canary.12.json",
      "manifest-0.1.3-canary.112.json",
      "manifest-0.1.3-canary.412.json",
    ];
    expect(findCanaryManifestAsset(counters, "12")).toBe(
      "manifest-0.1.3-canary.12.json",
    );
    expect(findCanaryManifestAsset(counters, "412")).toBe(
      "manifest-0.1.3-canary.412.json",
    );
  });

  test("fails when the build was pruned or the id is malformed", () => {
    expect(() =>
      findCanaryManifestAsset(assets, "20260101-000000-1234567"),
    ).toThrow(/found 0/);
    expect(() => findCanaryManifestAsset(assets, "nope")).toThrow(
      /not a canary build id/,
    );
  });
});

describe("walkArtifactEntries / artifactMismatches", () => {
  const manifest = daemonManifest(
    CANARY,
    "https://github.com/TurboPanel/turbopaneld/releases/download/canary",
  );

  test("finds every url+sha256+size object whatever the shape", () => {
    expect(walkArtifactEntries(manifest).map((e) => e.path)).toEqual([
      "binaryArtifacts.linux-amd64",
      "binaryArtifacts.linux-arm64",
      "jsFallbackArtifact",
      "orchestrationArtifact",
    ]);
    expect(
      walkArtifactEntries({
        artifacts: { ui: { url: "x/a", sha256: "s", size: 1 } },
        list: [{ url: "x/b", sha256: "s", size: 1 }],
      }).map((e) => e.path),
    ).toEqual(["artifacts.ui", "list[0]"]);
    expect(walkArtifactEntries(null)).toEqual([]);
  });

  test("passes when every asset is present and hashes to the manifest", () => {
    const files = new Map([
      [
        `turbopaneld-${CANARY}-amd64.tar.zst`,
        { sha256: "a".repeat(64), size: 10 },
      ],
      [
        `turbopaneld-${CANARY}-arm64.tar.zst`,
        { sha256: "b".repeat(64), size: 11 },
      ],
      [
        `turbopaneld.js-${CANARY}.tar.zst`,
        { sha256: "c".repeat(64), size: 12 },
      ],
      [`orchestration-${CANARY}.tar.zst`, { sha256: "d".repeat(64), size: 13 }],
    ]);
    expect(artifactMismatches(manifest, files)).toEqual([]);
  });

  test("names each missing or mismatching asset", () => {
    const files = new Map([
      [
        `turbopaneld-${CANARY}-amd64.tar.zst`,
        { sha256: "a".repeat(64), size: 10 },
      ],
      [
        `turbopaneld-${CANARY}-arm64.tar.zst`,
        { sha256: "b".repeat(64), size: 99 },
      ],
      [
        `turbopaneld.js-${CANARY}.tar.zst`,
        { sha256: "0".repeat(64), size: 12 },
      ],
    ]);
    const problems = artifactMismatches(manifest, files);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/linux-arm64.*size=99/);
    expect(problems[1]).toMatch(/jsFallbackArtifact.*sha256=000/);
    expect(problems[2]).toMatch(/orchestrationArtifact.*not downloaded/);
    expect(artifactMismatches({ schema: 1 }, new Map())).toEqual([
      "manifest names no artifacts (no object with url+sha256+size)",
    ]);
  });
});

describe("rewriteManifest", () => {
  const repo = "TurboPanel/turbopaneld";
  const source = daemonManifest(
    CANARY,
    `https://github.com/${repo}/releases/download/canary`,
  );

  test("canary → rc: renames assets, re-pins urls to the rc tag, keeps the bytes' identity, drops the signature", () => {
    const { manifest, renames } = rewriteManifest(source, {
      repo,
      sourceVersion: CANARY,
      targetVersion: "0.1.2-rc.1",
      channel: "rc",
    });
    expect(manifest.version).toBe("0.1.2-rc.1");
    expect(manifest.channel).toBe("rc");
    expect(manifest.commit).toBe(source.commit);
    expect(manifest.buildId).toBe(BUILD_ID);
    expect(manifest.builtAt).toBe(source.builtAt);
    expect(manifest).not.toHaveProperty("signature");
    const entries = walkArtifactEntries(manifest);
    expect(entries.map((e) => e.entry.url)).toEqual([
      `https://github.com/${repo}/releases/download/v0.1.2-rc.1/turbopaneld-0.1.2-rc.1-amd64.tar.zst`,
      `https://github.com/${repo}/releases/download/v0.1.2-rc.1/turbopaneld-0.1.2-rc.1-arm64.tar.zst`,
      `https://github.com/${repo}/releases/download/v0.1.2-rc.1/turbopaneld.js-0.1.2-rc.1.tar.zst`,
      `https://github.com/${repo}/releases/download/v0.1.2-rc.1/orchestration-0.1.2-rc.1.tar.zst`,
    ]);
    expect(entries.map((e) => e.entry.sha256)).toEqual(
      walkArtifactEntries(source).map((e) => e.entry.sha256),
    );
    expect(renames).toEqual([
      {
        from: `turbopaneld-${CANARY}-amd64.tar.zst`,
        to: "turbopaneld-0.1.2-rc.1-amd64.tar.zst",
      },
      {
        from: `turbopaneld-${CANARY}-arm64.tar.zst`,
        to: "turbopaneld-0.1.2-rc.1-arm64.tar.zst",
      },
      {
        from: `turbopaneld.js-${CANARY}.tar.zst`,
        to: "turbopaneld.js-0.1.2-rc.1.tar.zst",
      },
      {
        from: `orchestration-${CANARY}.tar.zst`,
        to: "orchestration-0.1.2-rc.1.tar.zst",
      },
    ]);
    // The source is untouched.
    expect(source.version).toBe(CANARY);
    expect(source).toHaveProperty("signature");
  });

  test("rc → release on the instance / ui shape", () => {
    const rc = {
      schema: 1,
      channel: "rc",
      version: "0.1.2-rc.1",
      commit: "abc",
      buildId: BUILD_ID,
      builtAt: "x",
      artifacts: {
        ui: {
          url: "https://github.com/TurboPanel/ui/releases/download/v0.1.2-rc.1/turbopanel-ui-0.1.2-rc.1.tar.gz",
          sha256: "e".repeat(64),
          size: 5,
        },
      },
    };
    const { manifest, renames } = rewriteManifest(rc, {
      repo: "TurboPanel/ui",
      sourceVersion: "0.1.2-rc.1",
      targetVersion: "0.1.2",
      channel: "release",
    });
    expect(manifest).toEqual({
      ...rc,
      version: "0.1.2",
      channel: "release",
      artifacts: {
        ui: {
          url: "https://github.com/TurboPanel/ui/releases/download/v0.1.2/turbopanel-ui-0.1.2.tar.gz",
          sha256: "e".repeat(64),
          size: 5,
        },
      },
    });
    expect(renames).toEqual([
      {
        from: "turbopanel-ui-0.1.2-rc.1.tar.gz",
        to: "turbopanel-ui-0.1.2.tar.gz",
      },
    ]);
  });

  test("refuses a manifest that is not the source version, has no commit, no artifacts, or unversioned asset names", () => {
    const opts = {
      repo,
      sourceVersion: CANARY,
      targetVersion: "0.1.2-rc.1",
      channel: "rc",
    };
    expect(() =>
      rewriteManifest({ ...source, version: "0.1.2" }, opts),
    ).toThrow(/not the source version/);
    expect(() => rewriteManifest({ ...source, commit: "" }, opts)).toThrow(
      /no commit/,
    );
    expect(() =>
      rewriteManifest({ version: CANARY, commit: "abc" }, opts),
    ).toThrow(/no artifacts/);
    expect(() =>
      rewriteManifest(
        {
          version: CANARY,
          commit: "abc",
          artifacts: {
            ui: { url: "https://x/ui.tar.gz", sha256: "s", size: 1 },
          },
        },
        opts,
      ),
    ).toThrow(/does not carry the source version/);
    expect(() =>
      rewriteManifest(
        {
          version: CANARY,
          commit: "abc",
          artifacts: {
            a: { url: `https://x/ui-${CANARY}.tar.gz`, sha256: "s", size: 1 },
            b: { url: `https://y/ui-${CANARY}.tar.gz`, sha256: "s", size: 1 },
          },
        },
        opts,
      ),
    ).toThrow(/two assets would be renamed/);
  });
});

describe("small helpers", () => {
  test("pendingChangesetCount ignores the README and config", () => {
    expect(pendingChangesetCount(["README.md", "config.json"])).toBe(0);
    expect(
      pendingChangesetCount([
        "README.md",
        "config.json",
        "brave-cats-sing.md",
        "two.md",
      ]),
    ).toBe(2);
  });

  test("repo kinds and branches", () => {
    expect(hasAssets("daemon")).toBe(true);
    expect(hasAssets("notes-only")).toBe(false);
    expect(assertRepoKind("ui")).toBe("ui");
    expect(() => assertRepoKind("website")).toThrow(/repo-kind must be one of/);
    expect(BRANCH_FOR_TARGET).toEqual({ rc: "staging", release: "live" });
  });

  test("release notes and output lines", () => {
    expect(
      releaseNotes({
        to: "rc",
        targetVersion: "0.1.2-rc.1",
        sourceVersion: CANARY,
        commit: "abc",
        repoKind: "daemon",
      }),
    ).toBe(
      `v0.1.2-rc.1 — promoted from canary build ${CANARY} (commit abc). Same bytes as the source build; only the asset names, manifest and its signature changed.`,
    );
    expect(
      releaseNotes({
        to: "release",
        targetVersion: "0.1.2",
        sourceVersion: "0.1.2-rc.1",
        commit: "abc",
        repoKind: "notes-only",
      }),
    ).toBe(
      "v0.1.2 — promoted from 0.1.2-rc.1 (commit abc). Notes-only release (no assets).",
    );
    expect(outputLines({ tag: "v1", "target-version": "1" })).toEqual([
      "tag=v1",
      "target-version=1",
    ]);
  });
});

describe("workflow shape", () => {
  const read = (name: string) => readFileSync(join(WORKFLOWS, name), "utf8");

  test("gh-promote.yml declares the promotion contract", () => {
    const text = read("gh-promote.yml");
    for (const input of [
      "repo-kind",
      "to",
      "source",
      "dev-ref",
      "signer-ref",
    ]) {
      expect(text, `input ${input}`).toMatch(
        new RegExp(`^      ${input}:$`, "m"),
      );
    }
    expect(text).not.toMatch(/^      RELEASE_SIGNING_KEY:$/m);
    expect(text).toContain(
      "RELEASE_SIGNING_KEY: ${{ secrets.TURBOPANEL_RELEASE_SIGNING_KEY }}",
    );
    for (const secret of ["RELEASE_APP_ID", "RELEASE_APP_PRIVATE_KEY"]) {
      expect(text, `secret ${secret}`).toMatch(
        new RegExp(`^      ${secret}:$`, "m"),
      );
    }
    for (const output of [
      "version",
      "tag",
      "commit",
      "source-version",
      "branch",
      "assets-artifact-name",
      "manifest-filename",
      "release-notes",
    ]) {
      expect(text, `output ${output}`).toMatch(
        new RegExp(
          `^      ${output}:\\n        description: .*\\n        value: \\$\\{\\{ jobs\\.prepare\\.outputs\\.`,
          "m",
        ),
      );
    }
    // The approval gate defaults to `release` and a caller can pass "" to drop it.
    expect(text).toMatch(
      /^      approval-environment:\n(?:        .*\n)*?        default: release$/m,
    );
    expect(text).toMatch(
      /^    environment: \$\{\{ inputs\.approval-environment \|\| \(inputs\.repo-kind != 'notes-only' && 'canary' \|\| null\) \}\}$/m,
    );
    // Every falsifiable check runs before the tag is created — a tag on a
    // build that then fails verification would burn the version.
    const order = [
      "Verify the source manifest's signature",
      "Verify the source assets against their manifest",
      "Refuse an rc while changesets are pending",
      "Sign the promoted manifest",
      "Create the ${{ steps.plan.outputs.tag }} tag",
    ].map((step) => text.indexOf(`- name: ${step}`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The App token is only minted for a release; rc tags use GITHUB_TOKEN.
    expect(text).toMatch(
      /name: Mint a Release App token\n        if: inputs\.to == 'release'/,
    );
  });

  test("gh-promote-finalize.yml flips latest, re-points rc, and never force-pushes", () => {
    const text = read("gh-promote-finalize.yml");
    expect(text).toMatch(/--prerelease=false --latest/);
    expect(text).toMatch(/gh release upload rc --repo "\$REPO" --clobber/);
    expect(text).toMatch(/git merge-base --is-ancestor/);
    expect(text).toMatch(/git merge --no-ff/);
    // A merged PR may already have brought the tag commit in: no move, no false 'diverged' warning.
    expect(text).toMatch(/is-ancestor "\$COMMIT" "origin\/\$BRANCH"/);
    for (const push of text.match(/git push[^\n]*/g) ?? []) {
      expect(push).not.toMatch(/--force|-f\b|\+refs\//);
    }
    expect(text).not.toMatch(/git merge --squash/);
    // One approval per promotion: only prepare is environment-gated.
    expect(text).not.toMatch(/^\s*environment:/m);
    // Without the App the manual route is a PR: direct pushes to staging/live
    // are refused for everyone by the rulesets.
    expect(text).toMatch(
      /gh pr create --repo \$REPO --base \$BRANCH --head promote\/v\$VERSION/,
    );
    expect(text).not.toMatch(/by hand from a checkout with push rights/);
  });

  test("gh-release.yml takes a target commit and defaults to the caller's sha", () => {
    const text = read("gh-release.yml");
    expect(text).toMatch(/^      target-commit:$/m);
    expect(text).toMatch(
      /TARGET_COMMIT: \$\{\{ inputs\.target-commit \|\| github\.sha \}\}/,
    );
    expect(text).not.toMatch(/--target "\$\{\{ github\.sha \}\}"/);
  });
});

describe("nextRcNumber", () => {
  test("counts numerically and ignores other bases and non-rc tags", () => {
    expect(nextRcNumber("0.1.3")).toBe(1);
    expect(
      nextRcNumber("0.1.3", [
        "v0.1.3",
        "v0.1.3-rc.9",
        "v0.1.3-rc.10",
        "v0.1.30-rc.4",
        "v0.1.3-rc.x",
      ]),
    ).toBe(11);
  });

  test("refuses a base that is not X.Y.Z", () => {
    expect(() => nextRcNumber("0.1")).toThrow(/bare X\.Y\.Z/);
  });
});

// The real tags of TurboPanel/turbopaneld on 2026-09-30, as the API lists them.
const DAEMON_TAGS = [
  "refs/tags/canary",
  "refs/tags/rc",
  "refs/tags/v0.1.0",
  "refs/tags/v0.1.1-rc.1",
  "refs/tags/v0.1.2",
  "refs/tags/v0.1.2-rc.1",
  "refs/tags/v0.1.3",
  "refs/tags/v0.1.3-rc.1",
  "refs/tags/v0.1.3-rc.2",
  "refs/tags/v0.1.4",
  "refs/tags/v0.1.4-rc.1",
  "refs/tags/v0.1.5",
  "refs/tags/v0.1.5-rc.1",
  "refs/tags/v0.1.5-rc.2",
];

describe("versions from tags", () => {
  test("compareVersions and nextPatch are numeric, never textual", () => {
    expect(compareVersions("0.1.10", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(nextPatch("0.1.9")).toBe("0.1.10");
    expect(() => compareVersions("0.1", "0.1.0")).toThrow(/bare X\.Y\.Z/);
  });

  test("the newest release is the highest bare vX.Y.Z; rolling and rc tags are not releases", () => {
    expect(latestRelease(DAEMON_TAGS)).toBe("0.1.5");
    expect(latestRelease(["v0.1.9", "v0.1.10", "v0.1.10-rc.1"])).toBe("0.1.10");
    expect(latestRelease(["canary", "v0.1.1-rc.1"])).toBeNull();
  });

  test("the base is the newest release's next patch — the state the four repos are in now", () => {
    expect(nextBase(DAEMON_TAGS)).toBe("0.1.6");
    expect(nextBase(["v0.1.3", "v0.1.4", "v0.1.4-rc.3"])).toBe("0.1.5");
    expect(nextBase(["v0.1.0", "v0.1.2", "v0.1.3-rc.1", "v0.1.3"])).toBe(
      "0.1.4",
    );
    // An old rc below the newest release (v0.1.1-rc.1 never shipped) is ignored.
    expect(nextBase(["v0.1.1-rc.1", "v0.1.0"])).toBe("0.1.1");
    expect(nextBase(["v0.1.1-rc.1", "v0.1.2"])).toBe("0.1.3");
  });

  test("an unreleased rc or a start/ marker above the release lifts the base", () => {
    expect(nextBase([...DAEMON_TAGS, "refs/tags/v0.1.6-rc.1"])).toBe("0.1.6");
    expect(nextBase([...DAEMON_TAGS, "refs/tags/start/v0.2.0"])).toBe("0.2.0");
    expect(
      nextBase([...DAEMON_TAGS, "start/v0.2.0", "start/v1.0.0", "v0.1.6-rc.2"]),
    ).toBe("1.0.0");
    // Once the started version ships, the marker is history and patches resume.
    expect(
      nextBase([...DAEMON_TAGS, "start/v0.2.0", "v0.2.0-rc.1", "v0.2.0"]),
    ).toBe("0.2.1");
    // A marker at or below the release, or a malformed one, changes nothing.
    expect(
      nextBase([...DAEMON_TAGS, "start/v0.1.5", "start/v0.3", "start/0.9.0"]),
    ).toBe("0.1.6");
  });

  test("a repo with no release yet starts at 0.1.0 (or a higher started version)", () => {
    expect(nextBase([])).toBe("0.1.0");
    expect(nextBase(["", "refs/tags/canary"])).toBe("0.1.0");
    expect(nextBase(["start/v0.3.0"])).toBe("0.3.0");
  });

  test("the canary counter restarts at 1 for each base and continues from the highest build", () => {
    const assets = [
      "manifest.json",
      "manifest-0.1.5-canary.449.json",
      "manifest-0.1.6-canary.9.json",
      "manifest-0.1.6-canary.10.json",
      "manifest-0.1.2-canary.20260926-101530-abc1234.json",
      "turbopaneld-0.1.6-canary.11-amd64.tar.zst",
      "manifest-0.1.60-canary.99.json",
    ];
    expect(nextCanaryNumber("0.1.6", assets)).toBe(11);
    expect(nextCanaryNumber("0.1.7", assets)).toBe(1);
    expect(nextCanaryNumber("0.2.0")).toBe(1);
    // The version in flight when Phase 3 lands continues from the run counter.
    expect(nextCanaryNumber("0.1.5", assets)).toBe(450);
    expect(() => nextCanaryNumber("0.1")).toThrow(/bare X\.Y\.Z/);
  });

  test("the Release PR ships the newest rc above the newest release, or nothing", () => {
    expect(newestUnreleasedRc(DAEMON_TAGS)).toBeNull();
    expect(
      newestUnreleasedRc([...DAEMON_TAGS, "v0.1.6-rc.9", "v0.1.6-rc.10"]),
    ).toEqual({ tag: "v0.1.6-rc.10", version: "0.1.6", number: 10 });
    // A started minor does not strand the patch rc already on staging…
    expect(
      newestUnreleasedRc([...DAEMON_TAGS, "start/v0.2.0", "v0.1.6-rc.2"]),
    ).toEqual({ tag: "v0.1.6-rc.2", version: "0.1.6", number: 2 });
    // …and once the minor has its own rc, that is the newest.
    expect(
      newestUnreleasedRc([...DAEMON_TAGS, "v0.1.6-rc.2", "v0.2.0-rc.1"]),
    ).toEqual({ tag: "v0.2.0-rc.1", version: "0.2.0", number: 1 });
    expect(newestUnreleasedRc(["v0.1.1-rc.3"])).toEqual({
      tag: "v0.1.1-rc.3",
      version: "0.1.1",
      number: 3,
    });
  });

  test("Start Next Version targets the next minor or major after the repo's own release", () => {
    expect(startTarget("minor", DAEMON_TAGS)).toEqual({
      released: "0.1.5",
      target: "0.2.0",
      base: "0.1.6",
      started: false,
    });
    expect(startTarget("major", DAEMON_TAGS)).toMatchObject({
      target: "1.0.0",
      started: false,
    });
    // Pressing it twice is harmless: the second run finds the minor started.
    expect(
      startTarget("minor", [...DAEMON_TAGS, "start/v0.2.0"]),
    ).toMatchObject({
      target: "0.2.0",
      base: "0.2.0",
      started: true,
    });
    expect(startTarget("major", ["v1.4.2"])).toMatchObject({ target: "2.0.0" });
    expect(startTarget("minor", [])).toMatchObject({
      released: "",
      target: "0.1.0",
    });
    expect(() => startTarget("patch", DAEMON_TAGS)).toThrow(/minor\|major/);
  });
});

describe("no Start PR, no minor gate", () => {
  test("the Start-PR and minor-gate machinery is gone for good", () => {
    for (const gone of [
      ".github/workflows/gh-next-version.yml",
      ".github/workflows/gh-minor-gate.yml",
      ".github/workflows/start-minor.yml",
      "scripts/promote/start-minor.sh",
      "scripts/promote/rerun-release-pr-checks.sh",
    ]) {
      expect(() => readFileSync(join(REPO_ROOT, gone)), gone).toThrow();
    }
    const cli = readFileSync(
      join(REPO_ROOT, "scripts/promote/cli.mjs"),
      "utf8",
    );
    expect(cli).not.toMatch(/next-version|bump-files/);
  });

  test("the Version From Tags action runs version.sh from its own commit", () => {
    const action = readFileSync(
      join(REPO_ROOT, ".github/actions/version/action.yml"),
      "utf8",
    );
    expect(action).toMatch(/^name: Version From Tags$/m);
    expect(action).toMatch(/^ {2}using: composite$/m);
    expect(action).toMatch(
      /run: sh "\$GITHUB_ACTION_PATH\/\.\.\/\.\.\/\.\.\/scripts\/promote\/version\.sh" "\$MODE" "\$COMMIT"/,
    );
    for (const output of [
      "release",
      "base",
      "number",
      "version",
      "asset",
      "rc-tag",
    ]) {
      expect(action, output).toMatch(
        new RegExp(
          `^ {2}${output}:\\n {4}description: .*\\n {4}value: \\$\\{\\{ steps\\.version\\.outputs\\.${output} \\}\\}$`,
          "m",
        ),
      );
    }
  });
});

describe("release notes with contributors", () => {
  test("gh-release passes the notes through the environment, never into the shell text", () => {
    const text = readFileSync(join(WORKFLOWS, "gh-release.yml"), "utf8");
    expect(text).toMatch(/RELEASE_NOTES: \$\{\{ inputs\.release-notes \}\}/);
    expect(text).not.toMatch(/--notes "\$\{\{/);
    expect(text).toMatch(/--notes "\$RELEASE_NOTES"/);
  });

  test("gh-promote appends the changelog (multi-line output) to the release notes", () => {
    const text = readFileSync(join(WORKFLOWS, "gh-promote.yml"), "utf8");
    expect(text).toMatch(/changelog\.sh/);
    expect(text).toMatch(/notes<<TP_RELEASE_NOTES_EOF/);
    expect(text).toMatch(/--exclude-pre-releases/);
  });

  test("gh-promote stops when the changelog cannot be built instead of dropping it", () => {
    const text = readFileSync(join(WORKFLOWS, "gh-promote.yml"), "utf8");
    const step = text.slice(text.indexOf("Write the release notes"));
    expect(step).not.toMatch(/changelog\.sh[^\n]*\|\| true/);
    expect(step).not.toMatch(
      /--jq '\.\[0\]\.tagName \/\/ empty'[^\n]*\|\| true/,
    );
  });
});

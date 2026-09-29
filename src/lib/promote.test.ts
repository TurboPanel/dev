import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  bumpVersionText,
  minorOf,
  nextRcNumber,
  nextVersion,
  artifactMismatches,
  assertRepoKind,
  assertTarget,
  BRANCH_FOR_TARGET,
  findCanaryManifestAsset,
  hasAssets,
  outputLines,
  parseSource,
  pendingChangesetCount,
  releaseNotes,
  rewriteManifest,
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
    for (const secret of [
      "RELEASE_SIGNING_KEY",
      "RELEASE_APP_ID",
      "RELEASE_APP_PRIVATE_KEY",
    ]) {
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
      /^    environment: \$\{\{ inputs\.approval-environment \|\| null \}\}$/m,
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

  test("promote.yml chains prepare → publish → finalize locally with dev-ref = github.sha", () => {
    const text = read("promote.yml");
    expect(text).toMatch(/uses: \.\/\.github\/workflows\/gh-promote\.yml/);
    expect(text).toMatch(/uses: \.\/\.github\/workflows\/gh-release\.yml/);
    expect(text).toMatch(
      /uses: \.\/\.github\/workflows\/gh-promote-finalize\.yml/,
    );
    expect(text).toMatch(/repo-kind: notes-only/);
    expect(text).toMatch(/dev-ref: \$\{\{ github\.sha \}\}/);
    expect(text).toMatch(
      /target-commit: \$\{\{ needs\.prepare\.outputs\.commit \}\}/,
    );
  });

  test("release.yml ignores tag pushes by the Release App", () => {
    expect(read("release.yml")).toMatch(
      /if: github\.event_name != 'push' \|\| !startsWith\(github\.ref, 'refs\/tags\/'\) \|\| !endsWith\(github\.actor, '\[bot\]'\)/,
    );
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

describe("nextVersion", () => {
  test("patch by default, minor when asked", () => {
    expect(nextVersion("0.1.3")).toBe("0.1.4");
    expect(nextVersion("0.1.3", { minor: true })).toBe("0.2.0");
  });

  test("never lands below the highest minor any repo is on", () => {
    expect(nextVersion("0.1.3", { floorMinor: 2 })).toBe("0.2.0");
    expect(nextVersion("0.1.3", { floorMinor: 1 })).toBe("0.1.4");
    expect(nextVersion("0.2.5", { floorMinor: 2 })).toBe("0.2.6");
    expect(nextVersion("0.1.3", { minor: true, floorMinor: 3 })).toBe("0.3.0");
  });

  test("refuses anything but a bare X.Y.Z", () => {
    expect(() => nextVersion("0.1.3-rc.1")).toThrow(/bare X\.Y\.Z/);
    expect(() => minorOf("v1")).toThrow(/bare X\.Y\.Z/);
    expect(minorOf("0.12.4")).toBe(12);
  });
});

describe("bumpVersionText", () => {
  test("rewrites the top-level json version and Sonar's project version only", () => {
    const pkg =
      '{\n  "name": "x",\n  "version": "0.1.3",\n  "dependencies": { "y": "0.1.3" }\n}\n';
    expect(bumpVersionText(pkg, "0.1.3", "0.1.4")).toBe(
      '{\n  "name": "x",\n  "version": "0.1.4",\n  "dependencies": { "y": "0.1.3" }\n}\n',
    );
    expect(
      bumpVersionText(
        "sonar.projectKey=a\nsonar.projectVersion=0.1.3\n",
        "0.1.3",
        "0.2.0",
      ),
    ).toBe("sonar.projectKey=a\nsonar.projectVersion=0.2.0\n");
  });

  test("throws when the file does not declare the version", () => {
    expect(() =>
      bumpVersionText('{"version": "0.1.9"}', "0.1.3", "0.1.4"),
    ).toThrow(/no version 0\.1\.3/);
    expect(() =>
      bumpVersionText('{"version": "0.1.30"}', "0.1.3", "0.1.4"),
    ).toThrow(/no version/);
  });

  test("dots in the old version are literal, not wildcards", () => {
    expect(() =>
      bumpVersionText('{\n  "version": "0x1y3"\n}', "0.1.3", "0.1.4"),
    ).toThrow(/no version 0\.1\.3/);
    expect(() =>
      bumpVersionText("sonar.projectVersion=0x1y3\n", "0.1.3", "0.1.4"),
    ).toThrow(/no version/);
  });

  test("a dotted prefix or suffix does not match (0.1.3 vs 0.1.30 and 10.1.3)", () => {
    expect(() =>
      bumpVersionText("sonar.projectVersion=0.1.30\n", "0.1.3", "0.1.4"),
    ).toThrow(/no version/);
    expect(() =>
      bumpVersionText('{\n  "version": "10.1.3"\n}', "0.1.3", "0.1.4"),
    ).toThrow(/no version/);
    expect(
      bumpVersionText('{\n  "version": "0.1.30"\n}', "0.1.30", "0.1.31"),
    ).toBe('{\n  "version": "0.1.31"\n}');
  });

  test("only the first declaration is rewritten, and whitespace around the key is tolerated", () => {
    const app =
      '{\n  "expo": {\n    "name": "x",\n    "version": "0.1.3"\n  },\n  "version"\n  :\n  "0.1.3"\n}\n';
    expect(bumpVersionText(app, "0.1.3", "0.1.4")).toBe(
      '{\n  "expo": {\n    "name": "x",\n    "version": "0.1.4"\n  },\n  "version"\n  :\n  "0.1.3"\n}\n',
    );
    expect(bumpVersionText('  "version"\t:\t"0.1.3",', "0.1.3", "0.1.4")).toBe(
      '  "version"\t:\t"0.1.4",',
    );
  });

  test("a key that merely ends in version, or a value without the closing quote, is left alone", () => {
    expect(() =>
      bumpVersionText('{\n  "appversion": "0.1.3"\n}', "0.1.3", "0.1.4"),
    ).toThrow(/no version/);
    expect(() =>
      bumpVersionText('{\n  "version": "0.1.3-rc.1"\n}', "0.1.3", "0.1.4"),
    ).toThrow(/no version/);
  });

  test("the Sonar line must end at the version: trailing text or a comment key is not matched", () => {
    expect(() =>
      bumpVersionText("sonar.projectVersion=0.1.3 # x\n", "0.1.3", "0.1.4"),
    ).toThrow(/no version/);
    expect(() =>
      bumpVersionText("# sonar.projectVersion=0.1.3\n", "0.1.3", "0.1.4"),
    ).toThrow(/no version/);
    expect(() =>
      bumpVersionText("sonar_projectVersion=0.1.3\n", "0.1.3", "0.1.4"),
    ).toThrow(/no version/);
    expect(
      bumpVersionText(
        "sonar.projectVersion=0.1.3\nsonar.other=0.1.3\n",
        "0.1.3",
        "0.1.4",
      ),
    ).toBe("sonar.projectVersion=0.1.4\nsonar.other=0.1.3\n");
  });

  test("the json form wins when a file carries both", () => {
    expect(
      bumpVersionText(
        'sonar.projectVersion=0.1.3\n"version": "0.1.3"\n',
        "0.1.3",
        "0.1.4",
      ),
    ).toBe('sonar.projectVersion=0.1.3\n"version": "0.1.4"\n');
  });
});

describe("gh-next-version.yml", () => {
  test("opens a PR with the App token, never pushes to trunk, and reads the CLI's floor", () => {
    const text = readFileSync(join(WORKFLOWS, "gh-next-version.yml"), "utf8");
    expect(text).toMatch(/create-github-app-token/);
    expect(text).toMatch(/gh pr create --repo "\$REPO" --base trunk/);
    expect(text).not.toMatch(/git push[^\n]*(trunk|--force)/);
    expect(text).toMatch(/cli\.mjs|\$CLI" next-version/);
    expect(text).toMatch(/--label minor/);
  });
});

describe("gh-minor-gate.yml", () => {
  const text = readFileSync(join(WORKFLOWS, "gh-minor-gate.yml"), "utf8");

  test("only gates a pull request into live, and only a minor (patch 0)", () => {
    expect(text).toMatch(
      /"\$EVENT" = "pull_request" \] && \[ "\$BASE" = "live"/,
    );
    expect(text).toMatch(/patch="\$\{version##\*\.\}"/);
    expect(text).toMatch(/if: steps\.version\.outputs\.minor == 'true'/);
  });

  test("daemon role wants an rc of the minor in each sibling; dependent role wants the daemon release", () => {
    expect(text).toMatch(/matching-refs\/tags\/v\$VERSION-rc\./);
    expect(text).toMatch(/releases\/tags\/v\$VERSION/);
    expect(text).toMatch(/\.prerelease/);
  });

  test("never gates website or dev, and never a patch on another repo's release", () => {
    expect(text).toMatch(
      /repositories: \|\n\s+turbopaneld\n\s+turbopanel\n\s+ui\n/,
    );
  });
});

describe("minor start + re-run scripts", () => {
  const start = readFileSync(
    join(REPO_ROOT, "scripts/promote/start-minor.sh"),
    "utf8",
  );
  const rerun = readFileSync(
    join(REPO_ROOT, "scripts/promote/rerun-release-pr-checks.sh"),
    "utf8",
  );

  test("start-minor covers exactly the three repos that ship a minor together, only minors", () => {
    expect(start).toMatch(/turbopaneld:deno\.json/);
    expect(start).toMatch(/turbopanel:deno\.json:deno\.json,package\.json/);
    expect(start).toMatch(/ui:package\.json:package\.json,app\.json/);
    expect(start).not.toMatch(/website|"dev:/);
    expect(start).toMatch(/\[0-9\]\*\.\[0-9\]\*\.0\)/);
  });

  test("gh-next-version hands a new minor to start-minor, skipping its own repo", () => {
    const next = readFileSync(join(WORKFLOWS, "gh-next-version.yml"), "utf8");
    expect(next).toMatch(/start-minor\.sh "\$next"/);
    expect(next).toMatch(/"\$\{next%\.\*\}" != "\$\{RELEASED%\.\*\}"/);
  });

  test("the manual start-minor workflow is a dispatch that opens PRs only", () => {
    const wf = readFileSync(join(WORKFLOWS, "start-minor.yml"), "utf8");
    expect(wf).toMatch(/workflow_dispatch/);
    expect(wf).not.toMatch(/git push[^\n]*trunk/);
  });

  test("re-running sibling checks never fails the caller", () => {
    expect(rerun).toMatch(/gh run rerun/);
    expect(rerun.trimEnd().endsWith("exit 0")).toBe(true);
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
});

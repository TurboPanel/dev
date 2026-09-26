import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
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
      "linux-amd64": { url: `${base}/turbopaneld-${version}-amd64.tar.zst`, sha256: "a".repeat(64), size: 10 },
      "linux-arm64": { url: `${base}/turbopaneld-${version}-arm64.tar.zst`, sha256: "b".repeat(64), size: 11 },
    },
    jsFallbackArtifact: { url: `${base}/turbopaneld.js-${version}.tar.zst`, sha256: "c".repeat(64), size: 12 },
    orchestrationArtifact: { url: `${base}/orchestration-${version}.tar.zst`, sha256: "d".repeat(64), size: 13 },
    signature: { alg: "ed25519", keyId: "c72c6744", value: "AAAA" },
  };
}

describe("targetVersion", () => {
  test("rc strips the canary label and appends -rc.1", () => {
    expect(targetVersion("rc", CANARY)).toBe("0.1.2-rc.1");
  });

  test("rc accepts a bare version (notes-only repos have no canary)", () => {
    expect(targetVersion("rc", "0.1.2")).toBe("0.1.2-rc.1");
  });

  test("rc refuses any other pre-release label — an rc is never cut from an rc", () => {
    expect(() => targetVersion("rc", "0.1.2-rc.1")).toThrow(/canary build or a bare/);
    expect(() => targetVersion("rc", "0.1.2-beta.1")).toThrow(/canary build or a bare/);
    expect(() => targetVersion("rc", "")).toThrow(/empty/);
  });

  test("release strips exactly -rc.1", () => {
    expect(targetVersion("release", "0.1.2-rc.1")).toBe("0.1.2");
  });

  test("release refuses rc.2, canaries and bare versions", () => {
    expect(() => targetVersion("release", "0.1.2-rc.2")).toThrow(/rc\.1 pre-release/);
    expect(() => targetVersion("release", CANARY)).toThrow(/rc\.1 pre-release/);
    expect(() => targetVersion("release", "0.1.2")).toThrow(/rc\.1 pre-release/);
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
    expect(parseSource("rc", ` ${BUILD_ID} `)).toEqual({ kind: "canary-build-id", buildId: BUILD_ID });
  });

  test("rc: a canary version or its manifest copy resolve to the same asset", () => {
    const expected = { kind: "canary-version", version: CANARY, buildId: BUILD_ID, asset: `manifest-${CANARY}.json` };
    expect(parseSource("rc", CANARY)).toEqual(expected);
    expect(parseSource("rc", `manifest-${CANARY}.json`)).toEqual(expected);
  });

  test("rc: anything else is refused with the accepted forms", () => {
    expect(() => parseSource("rc", "0.1.2")).toThrow(/canary build id/);
    expect(() => parseSource("rc", "manifest-0.1.2.json")).toThrow(/not a canary manifest copy/);
    expect(() => parseSource("rc", "")).toThrow(/empty/);
  });

  test("release: the rc tag with or without the v", () => {
    expect(parseSource("release", "v0.1.2-rc.1")).toEqual({ kind: "rc-tag", version: "0.1.2-rc.1", tag: "v0.1.2-rc.1" });
    expect(parseSource("release", "0.1.2-rc.1")).toEqual({ kind: "rc-tag", version: "0.1.2-rc.1", tag: "v0.1.2-rc.1" });
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
    expect(findCanaryManifestAsset(assets, BUILD_ID)).toBe(`manifest-${CANARY}.json`);
  });

  test("fails when the build was pruned or the id is malformed", () => {
    expect(() => findCanaryManifestAsset(assets, "20260101-000000-1234567")).toThrow(/found 0/);
    expect(() => findCanaryManifestAsset(assets, "nope")).toThrow(/not a canary build id/);
  });
});

describe("walkArtifactEntries / artifactMismatches", () => {
  const manifest = daemonManifest(CANARY, "https://github.com/TurboPanel/turbopaneld/releases/download/canary");

  test("finds every url+sha256+size object whatever the shape", () => {
    expect(walkArtifactEntries(manifest).map((e) => e.path)).toEqual([
      "binaryArtifacts.linux-amd64",
      "binaryArtifacts.linux-arm64",
      "jsFallbackArtifact",
      "orchestrationArtifact",
    ]);
    expect(walkArtifactEntries({ artifacts: { ui: { url: "x/a", sha256: "s", size: 1 } }, list: [{ url: "x/b", sha256: "s", size: 1 }] }).map((e) => e.path))
      .toEqual(["artifacts.ui", "list[0]"]);
    expect(walkArtifactEntries(null)).toEqual([]);
  });

  test("passes when every asset is present and hashes to the manifest", () => {
    const files = new Map([
      [`turbopaneld-${CANARY}-amd64.tar.zst`, { sha256: "a".repeat(64), size: 10 }],
      [`turbopaneld-${CANARY}-arm64.tar.zst`, { sha256: "b".repeat(64), size: 11 }],
      [`turbopaneld.js-${CANARY}.tar.zst`, { sha256: "c".repeat(64), size: 12 }],
      [`orchestration-${CANARY}.tar.zst`, { sha256: "d".repeat(64), size: 13 }],
    ]);
    expect(artifactMismatches(manifest, files)).toEqual([]);
  });

  test("names each missing or mismatching asset", () => {
    const files = new Map([
      [`turbopaneld-${CANARY}-amd64.tar.zst`, { sha256: "a".repeat(64), size: 10 }],
      [`turbopaneld-${CANARY}-arm64.tar.zst`, { sha256: "b".repeat(64), size: 99 }],
      [`turbopaneld.js-${CANARY}.tar.zst`, { sha256: "0".repeat(64), size: 12 }],
    ]);
    const problems = artifactMismatches(manifest, files);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/linux-arm64.*size=99/);
    expect(problems[1]).toMatch(/jsFallbackArtifact.*sha256=000/);
    expect(problems[2]).toMatch(/orchestrationArtifact.*not downloaded/);
    expect(artifactMismatches({ schema: 1 }, new Map())).toEqual(["manifest names no artifacts (no object with url+sha256+size)"]);
  });
});

describe("rewriteManifest", () => {
  const repo = "TurboPanel/turbopaneld";
  const source = daemonManifest(CANARY, `https://github.com/${repo}/releases/download/canary`);

  test("canary → rc: renames assets, re-pins urls to the rc tag, keeps the bytes' identity, drops the signature", () => {
    const { manifest, renames } = rewriteManifest(source, { repo, sourceVersion: CANARY, targetVersion: "0.1.2-rc.1", channel: "rc" });
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
    expect(entries.map((e) => e.entry.sha256)).toEqual(walkArtifactEntries(source).map((e) => e.entry.sha256));
    expect(renames).toEqual([
      { from: `turbopaneld-${CANARY}-amd64.tar.zst`, to: "turbopaneld-0.1.2-rc.1-amd64.tar.zst" },
      { from: `turbopaneld-${CANARY}-arm64.tar.zst`, to: "turbopaneld-0.1.2-rc.1-arm64.tar.zst" },
      { from: `turbopaneld.js-${CANARY}.tar.zst`, to: "turbopaneld.js-0.1.2-rc.1.tar.zst" },
      { from: `orchestration-${CANARY}.tar.zst`, to: "orchestration-0.1.2-rc.1.tar.zst" },
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
      artifacts: { ui: { url: "https://github.com/TurboPanel/ui/releases/download/v0.1.2-rc.1/turbopanel-ui-0.1.2-rc.1.tar.gz", sha256: "e".repeat(64), size: 5 } },
    };
    const { manifest, renames } = rewriteManifest(rc, { repo: "TurboPanel/ui", sourceVersion: "0.1.2-rc.1", targetVersion: "0.1.2", channel: "release" });
    expect(manifest).toEqual({
      ...rc,
      version: "0.1.2",
      channel: "release",
      artifacts: { ui: { url: "https://github.com/TurboPanel/ui/releases/download/v0.1.2/turbopanel-ui-0.1.2.tar.gz", sha256: "e".repeat(64), size: 5 } },
    });
    expect(renames).toEqual([{ from: "turbopanel-ui-0.1.2-rc.1.tar.gz", to: "turbopanel-ui-0.1.2.tar.gz" }]);
  });

  test("refuses a manifest that is not the source version, has no commit, no artifacts, or unversioned asset names", () => {
    const opts = { repo, sourceVersion: CANARY, targetVersion: "0.1.2-rc.1", channel: "rc" };
    expect(() => rewriteManifest({ ...source, version: "0.1.2" }, opts)).toThrow(/not the source version/);
    expect(() => rewriteManifest({ ...source, commit: "" }, opts)).toThrow(/no commit/);
    expect(() => rewriteManifest({ version: CANARY, commit: "abc" }, opts)).toThrow(/no artifacts/);
    expect(() =>
      rewriteManifest(
        { version: CANARY, commit: "abc", artifacts: { ui: { url: "https://x/ui.tar.gz", sha256: "s", size: 1 } } },
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
    expect(pendingChangesetCount(["README.md", "config.json", "brave-cats-sing.md", "two.md"])).toBe(2);
  });

  test("repo kinds and branches", () => {
    expect(hasAssets("daemon")).toBe(true);
    expect(hasAssets("notes-only")).toBe(false);
    expect(assertRepoKind("ui")).toBe("ui");
    expect(() => assertRepoKind("website")).toThrow(/repo-kind must be one of/);
    expect(BRANCH_FOR_TARGET).toEqual({ rc: "staging", release: "live" });
  });

  test("release notes and output lines", () => {
    expect(releaseNotes({ to: "rc", targetVersion: "0.1.2-rc.1", sourceVersion: CANARY, commit: "abc", repoKind: "daemon" })).toBe(
      `v0.1.2-rc.1 — promoted from canary build ${CANARY} (commit abc). Same bytes as the source build; only the asset names, manifest and its signature changed.`,
    );
    expect(releaseNotes({ to: "release", targetVersion: "0.1.2", sourceVersion: "0.1.2-rc.1", commit: "abc", repoKind: "notes-only" })).toBe(
      "v0.1.2 — promoted from 0.1.2-rc.1 (commit abc). Notes-only release (no assets).",
    );
    expect(outputLines({ tag: "v1", "target-version": "1" })).toEqual(["tag=v1", "target-version=1"]);
  });
});

describe("workflow shape", () => {
  const read = (name: string) => readFileSync(join(WORKFLOWS, name), "utf8");

  test("gh-promote.yml declares the promotion contract", () => {
    const text = read("gh-promote.yml");
    for (const input of ["repo-kind", "to", "source", "dev-ref", "signer-ref"]) {
      expect(text, `input ${input}`).toMatch(new RegExp(`^      ${input}:$`, "m"));
    }
    for (const secret of ["RELEASE_SIGNING_KEY", "RELEASE_APP_ID", "RELEASE_APP_PRIVATE_KEY"]) {
      expect(text, `secret ${secret}`).toMatch(new RegExp(`^      ${secret}:$`, "m"));
    }
    for (const output of ["version", "tag", "commit", "source-version", "branch", "assets-artifact-name", "manifest-filename", "release-notes"]) {
      expect(text, `output ${output}`).toMatch(new RegExp(`^      ${output}:\\n        description: .*\\n        value: \\$\\{\\{ jobs\\.prepare\\.outputs\\.`, "m"));
    }
    expect(text).toMatch(/^    environment: release$/m);
    // Every falsifiable check runs before the tag is created — a tag on a
    // build that then fails verification would burn the version.
    const order = ["Verify the source manifest's signature", "Verify the source assets against their manifest", "Refuse an rc while changesets are pending", "Sign the promoted manifest", "Create the ${{ steps.plan.outputs.tag }} tag"]
      .map((step) => text.indexOf(`- name: ${step}`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The App token is only minted for a release; rc tags use GITHUB_TOKEN.
    expect(text).toMatch(/name: Mint a Release App token\n        if: inputs\.to == 'release'/);
  });

  test("gh-promote-finalize.yml flips latest, re-points rc, and never force-pushes", () => {
    const text = read("gh-promote-finalize.yml");
    expect(text).toMatch(/--prerelease=false --latest/);
    expect(text).toMatch(/gh release upload rc --repo "\$REPO" --clobber/);
    expect(text).toMatch(/git merge-base --is-ancestor/);
    expect(text).toMatch(/git merge --no-ff/);
    for (const push of text.match(/git push[^\n]*/g) ?? []) {
      expect(push).not.toMatch(/--force|-f\b|\+refs\//);
    }
    expect(text).not.toMatch(/git merge --squash/);
    expect(text).toMatch(/^    environment: release$/m);
  });

  test("gh-release.yml takes a target commit and defaults to the caller's sha", () => {
    const text = read("gh-release.yml");
    expect(text).toMatch(/^      target-commit:$/m);
    expect(text).toMatch(/TARGET_COMMIT: \$\{\{ inputs\.target-commit \|\| github\.sha \}\}/);
    expect(text).not.toMatch(/--target "\$\{\{ github\.sha \}\}"/);
  });

  test("promote.yml chains prepare → publish → finalize locally with dev-ref = github.sha", () => {
    const text = read("promote.yml");
    expect(text).toMatch(/uses: \.\/\.github\/workflows\/gh-promote\.yml/);
    expect(text).toMatch(/uses: \.\/\.github\/workflows\/gh-release\.yml/);
    expect(text).toMatch(/uses: \.\/\.github\/workflows\/gh-promote-finalize\.yml/);
    expect(text).toMatch(/repo-kind: notes-only/);
    expect(text).toMatch(/dev-ref: \$\{\{ github\.sha \}\}/);
    expect(text).toMatch(/target-commit: \$\{\{ needs\.prepare\.outputs\.commit \}\}/);
  });

  test("release.yml ignores tag pushes by the Release App", () => {
    expect(read("release.yml")).toMatch(/if: github\.event_name != 'push' \|\| !endsWith\(github\.actor, '\[bot\]'\)/);
  });
});

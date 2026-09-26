// Pure logic behind .github/workflows/gh-promote.yml — the one-click
// canary → rc → release promotion (Testing Checklist rel-s19..s21). Plain
// ESM with no dependencies so the workflow can run it on a bare runner with
// `node scripts/promote/cli.mjs`; src/lib/promote.test.ts covers it.
//
// The version model (release-flow decision D8, "Option A"): every canary of a
// cycle carries the calculated next number plus a build label
// (`0.1.2-canary.20260926-101530-abc1234`); promoting makes it exactly one rc
// (`0.1.2-rc.1`, never rc.2) and then the bare release (`0.1.2`). The bytes
// never change across the hops — only the asset names, the manifest's
// version/channel/urls, and the manifest's signature.

/** Build id a canary asset name carries: yyyymmdd-hhmmss-sha7. */
export const CANARY_BUILD_ID_RE = /^\d{8}-\d{6}-[0-9a-f]{7}$/;
const CANARY_LABEL_RE = /-canary\.(\d{8}-\d{6}-[0-9a-f]{7})$/;
const RC_LABEL = "-rc.1";
const BASE_VERSION_RE = /^\d+\.\d+\.\d+$/;

export const TARGETS = Object.freeze(["rc", "release"]);
export const REPO_KINDS = Object.freeze(["daemon", "instance", "ui", "notes-only"]);

/** Branch each hop fast-forwards (Workers Builds deploy from these). */
export const BRANCH_FOR_TARGET = Object.freeze({ rc: "staging", release: "live" });

/** Repo kinds that publish assets + a signed manifest (everything but notes-only). */
export function hasAssets(repoKind) {
  return repoKind !== "notes-only";
}

export function assertTarget(to) {
  if (!TARGETS.includes(to)) {
    throw new Error(`to must be one of ${TARGETS.join("|")}, got ${JSON.stringify(to)}`);
  }
  return to;
}

export function assertRepoKind(repoKind) {
  if (!REPO_KINDS.includes(repoKind)) {
    throw new Error(
      `repo-kind must be one of ${REPO_KINDS.join("|")}, got ${JSON.stringify(repoKind)}`,
    );
  }
  return repoKind;
}

/**
 * The version a promotion publishes, derived from the version it starts
 * from. rc strips the canary label (a bare version — notes-only repos have
 * no canary — is accepted as-is); release strips `-rc.1` and nothing else.
 */
export function targetVersion(to, sourceVersion) {
  assertTarget(to);
  if (typeof sourceVersion !== "string" || sourceVersion === "") {
    throw new Error("source version is empty");
  }
  if (to === "rc") {
    const base = sourceVersion.replace(CANARY_LABEL_RE, "");
    if (!BASE_VERSION_RE.test(base)) {
      throw new Error(
        `an rc is cut from a canary build or a bare X.Y.Z version, not ${sourceVersion}`,
      );
    }
    return `${base}${RC_LABEL}`;
  }
  if (!sourceVersion.endsWith(RC_LABEL)) {
    throw new Error(`a release is cut from an ${RC_LABEL.slice(1)} pre-release, not ${sourceVersion}`);
  }
  const base = sourceVersion.slice(0, -RC_LABEL.length);
  if (!BASE_VERSION_RE.test(base)) {
    throw new Error(`rc version ${sourceVersion} does not wrap a bare X.Y.Z version`);
  }
  return base;
}

/**
 * What the workflow's free-text `source` input names. For rc: a canary build
 * id, a full canary version, or the `manifest-<version>.json` copy on the
 * rolling canary release. For release: the rc tag or version.
 */
export function parseSource(to, source) {
  assertTarget(to);
  const text = typeof source === "string" ? source.trim() : "";
  if (text === "") throw new Error("source is empty");
  if (to === "release") {
    const version = text.startsWith("v") ? text.slice(1) : text;
    if (!version.endsWith(RC_LABEL)) {
      throw new Error(`source for a release must be the rc tag (vX.Y.Z${RC_LABEL}), got ${text}`);
    }
    return { kind: "rc-tag", version, tag: `v${version}` };
  }
  if (CANARY_BUILD_ID_RE.test(text)) return { kind: "canary-build-id", buildId: text };
  const manifest = /^manifest-(.+)\.json$/.exec(text);
  if (manifest) {
    const version = manifest[1];
    const label = CANARY_LABEL_RE.exec(version);
    if (!label) throw new Error(`${text} is not a canary manifest copy`);
    return { kind: "canary-version", version, buildId: label[1], asset: text };
  }
  const label = CANARY_LABEL_RE.exec(text);
  if (label) {
    return {
      kind: "canary-version",
      version: text,
      buildId: label[1],
      asset: `manifest-${text}.json`,
    };
  }
  throw new Error(
    `source for an rc must be a canary build id (yyyymmdd-hhmmss-sha7), a canary version, or manifest-<version>.json; got ${text}`,
  );
}

/**
 * Pick the `manifest-<version>.json` copy on the rolling canary release for
 * a build id. Exactly one must match: gh-canary.yml names the copy after the
 * build's version, which ends in the build id.
 */
export function findCanaryManifestAsset(assetNames, buildId) {
  if (!CANARY_BUILD_ID_RE.test(buildId)) throw new Error(`not a canary build id: ${buildId}`);
  const matches = assetNames.filter(
    (name) => name.startsWith("manifest-") && name.endsWith(`-canary.${buildId}.json`),
  );
  if (matches.length !== 1) {
    throw new Error(
      `expected one manifest-<version>-canary.${buildId}.json on the canary release, found ${matches.length} (has it been pruned? the rail keeps the newest 20 builds)`,
    );
  }
  return matches[0];
}

/**
 * Every artifact entry in a manifest — an object carrying url + sha256 +
 * size — wherever it sits. Same walk gh-release.yml verifies with, so the
 * daemon's binaryArtifacts / jsFallbackArtifact / orchestrationArtifact and
 * the instance's / UI's artifacts.<name> share one code path.
 */
export function walkArtifactEntries(node, path = "") {
  const out = [];
  if (Array.isArray(node)) {
    node.forEach((value, i) => out.push(...walkArtifactEntries(value, `${path}[${i}]`)));
    return out;
  }
  if (node && typeof node === "object") {
    if ("url" in node && "sha256" in node && "size" in node) {
      return [{ path, entry: node }];
    }
    for (const [key, value] of Object.entries(node)) {
      out.push(...walkArtifactEntries(value, path ? `${path}.${key}` : key));
    }
  }
  return out;
}

export function assetFilename(url) {
  return url.slice(url.lastIndexOf("/") + 1);
}

/**
 * Compare the downloaded source assets against the manifest they came with.
 * `files` maps asset filename → { sha256, size }. Returns the problems, empty
 * when every named artifact is present and matches.
 */
export function artifactMismatches(manifest, files) {
  const problems = [];
  const entries = walkArtifactEntries(manifest);
  if (entries.length === 0) problems.push("manifest names no artifacts (no object with url+sha256+size)");
  for (const { path, entry } of entries) {
    const name = assetFilename(entry.url);
    const file = files.get(name);
    if (!file) {
      problems.push(`${path}: ${name} was not downloaded`);
      continue;
    }
    if (file.sha256 !== entry.sha256 || file.size !== entry.size) {
      problems.push(
        `${path}: ${name} expected sha256=${entry.sha256} size=${entry.size} got sha256=${file.sha256} size=${file.size}`,
      );
    }
  }
  return problems;
}

/**
 * The promoted manifest: same bytes (sha256/size, commit, buildId, builtAt
 * untouched), new version and channel, every asset renamed from the source
 * version to the target version and its url re-pinned to the target
 * release. The old signature is dropped; the workflow signs the result.
 */
export function rewriteManifest(manifest, { repo, sourceVersion, targetVersion: target, channel }) {
  if (manifest.version !== sourceVersion) {
    throw new Error(`manifest version ${manifest.version} is not the source version ${sourceVersion}`);
  }
  if (typeof manifest.commit !== "string" || manifest.commit === "") {
    throw new Error("manifest has no commit");
  }
  const next = structuredClone(manifest);
  delete next.signature;
  next.version = target;
  next.channel = channel;
  const renames = [];
  for (const { path, entry } of walkArtifactEntries(next)) {
    const from = assetFilename(entry.url);
    const to = from.replaceAll(sourceVersion, target);
    if (to === from) {
      throw new Error(`${path}: asset ${from} does not carry the source version ${sourceVersion} in its name`);
    }
    if (renames.some((r) => r.to === to)) throw new Error(`${path}: two assets would be renamed to ${to}`);
    entry.url = `https://github.com/${repo}/releases/download/v${target}/${to}`;
    renames.push({ from, to });
  }
  if (renames.length === 0) throw new Error("manifest names no artifacts to promote");
  return { manifest: next, renames };
}

/**
 * Pending changesets at a commit: every `.changeset/*.md` except the README
 * Changesets ships (config.json lives there too). An rc cut while these are
 * pending would carry a number the Version Packages PR is about to change.
 */
export function pendingChangesetCount(changesetDirEntries) {
  return changesetDirEntries.filter((name) => name.endsWith(".md") && name !== "README.md").length;
}

/** Text for the promoted GitHub Release. */
export function releaseNotes({ to, targetVersion: target, sourceVersion, commit, repoKind }) {
  const hop = to === "rc" ? `promoted from canary build ${sourceVersion}` : `promoted from ${sourceVersion}`;
  const bytes = hasAssets(repoKind)
    ? "Same bytes as the source build; only the asset names, manifest and its signature changed."
    : "Notes-only release (no assets).";
  return `v${target} — ${hop} (commit ${commit}). ${bytes}`;
}

/** GITHUB_OUTPUT lines for a resolved plan. */
export function outputLines(plan) {
  return Object.entries(plan).map(([key, value]) => `${key}=${value}`);
}

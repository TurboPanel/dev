// Pure logic behind .github/workflows/gh-promote.yml — the one-click
// canary → rc → release promotion (Testing Checklist rel-s19..s21). Plain
// ESM with no dependencies so the workflow can run it on a bare runner with
// `node scripts/promote/cli.mjs`; src/lib/promote.test.ts covers it.
//
// The version model (release-flow decisions D8, 2026-09-28, and Phase 3
// "versions from tags"): the number comes from the repo's git tags, never a
// file (nextBase below). Every canary of a cycle is that base plus a counter
// that restarts at 1 for each base (`0.1.4-canary.3`); promoting makes it the
// next rc candidate (`0.1.4-rc.1`; a bad candidate is fixed on trunk and the
// next merge cuts `0.1.4-rc.2` — the number stays until it ships) and then the
// bare release (`0.1.4`), cut from the newest rc. Only the base is stamped
// into the binaries; the channel and counter live in the signed manifest.
// The bytes never change across the hops — only the asset names, the
// manifest's version/channel/urls, and the manifest's signature.
//
// Builds cut before 2026-09-28 spell the canary label as a timestamped id
// (`0.1.2-canary.20260926-101530-abc1234`); that spelling is still read so an
// existing canary can be promoted.

/**
 * Build id a canary asset name carries: the counter (`3`; builds cut before
 * Phase 3 carry the workflow run number, `412`), or the pre-2026-09-28
 * spelling yyyymmdd-hhmmss-sha7.
 */
export const CANARY_BUILD_ID_RE = /^(?:\d+|\d{8}-\d{6}-[0-9a-f]{7})$/;
const CANARY_LABEL_RE = /-canary\.(\d+|\d{8}-\d{6}-[0-9a-f]{7})$/;
/** `-rc.<N>` on a version: N counts the candidates cut for one number. */
const RC_LABEL_RE = /-rc\.(\d+)$/;
const BASE_VERSION_RE = /^\d+\.\d+\.\d+$/;

export const TARGETS = Object.freeze(["rc", "release"]);
export const REPO_KINDS = Object.freeze([
  "daemon",
  "instance",
  "ui",
  "notes-only",
]);

/** Branch each hop fast-forwards (Workers Builds deploy from these). */
export const BRANCH_FOR_TARGET = Object.freeze({
  rc: "staging",
  release: "live",
});

/** Repo kinds that publish assets + a signed manifest (everything but notes-only). */
export function hasAssets(repoKind) {
  return repoKind !== "notes-only";
}

export function assertTarget(to) {
  if (!TARGETS.includes(to)) {
    throw new Error(
      `to must be one of ${TARGETS.join("|")}, got ${JSON.stringify(to)}`,
    );
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
 * The next rc number for a base version: one past the highest `v<base>-rc.N`
 * among the repo's tags (`existingTags`, tag names with or without refs/tags/),
 * or 1 when there is none. Numeric, so rc.10 follows rc.9.
 */
export function nextRcNumber(base, existingTags = []) {
  if (!BASE_VERSION_RE.test(base)) throw new Error(`not a bare X.Y.Z: ${base}`);
  const prefix = `v${base}-rc.`;
  let highest = 0;
  for (const raw of existingTags) {
    const tag = raw.replace(/^refs\/tags\//, "");
    if (!tag.startsWith(prefix)) continue;
    const n = /^\d+$/.test(tag.slice(prefix.length))
      ? Number(tag.slice(prefix.length))
      : 0;
    if (n > highest) highest = n;
  }
  return highest + 1;
}

/**
 * The version a promotion publishes, derived from the version it starts
 * from. rc strips the canary label (a bare version — notes-only repos have
 * no canary — is accepted as-is) and appends `-rc.<N>`, N being one past the
 * highest existing rc tag for that number (`existingTags`); release strips
 * `-rc.<N>` and nothing else.
 */
export function targetVersion(to, sourceVersion, existingTags = []) {
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
    return `${base}-rc.${nextRcNumber(base, existingTags)}`;
  }
  const rc = RC_LABEL_RE.exec(sourceVersion);
  if (!rc) {
    throw new Error(
      `a release is cut from an rc pre-release, not ${sourceVersion}`,
    );
  }
  const base = sourceVersion.slice(0, -rc[0].length);
  if (!BASE_VERSION_RE.test(base)) {
    throw new Error(
      `rc version ${sourceVersion} does not wrap a bare X.Y.Z version`,
    );
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
    if (!RC_LABEL_RE.test(version)) {
      throw new Error(
        `source for a release must be the rc tag (vX.Y.Z-rc.N), got ${text}`,
      );
    }
    return { kind: "rc-tag", version, tag: `v${version}` };
  }
  if (CANARY_BUILD_ID_RE.test(text))
    return { kind: "canary-build-id", buildId: text };
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
    `source for an rc must be a canary build number, a canary version, or manifest-<version>.json; got ${text}`,
  );
}

/**
 * Pick the `manifest-<version>.json` copy on the rolling canary release for
 * a build id. Exactly one must match: gh-canary.yml names the copy after the
 * build's version, which ends in the build id.
 */
export function findCanaryManifestAsset(assetNames, buildId) {
  if (!CANARY_BUILD_ID_RE.test(buildId))
    throw new Error(`not a canary build id: ${buildId}`);
  const matches = assetNames.filter(
    (name) =>
      name.startsWith("manifest-") && name.endsWith(`-canary.${buildId}.json`),
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
    node.forEach((value, i) =>
      out.push(...walkArtifactEntries(value, `${path}[${i}]`)),
    );
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
  if (entries.length === 0)
    problems.push(
      "manifest names no artifacts (no object with url+sha256+size)",
    );
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
export function rewriteManifest(
  manifest,
  { repo, sourceVersion, targetVersion: target, channel },
) {
  if (manifest.version !== sourceVersion) {
    throw new Error(
      `manifest version ${manifest.version} is not the source version ${sourceVersion}`,
    );
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
      throw new Error(
        `${path}: asset ${from} does not carry the source version ${sourceVersion} in its name`,
      );
    }
    if (renames.some((r) => r.to === to))
      throw new Error(`${path}: two assets would be renamed to ${to}`);
    entry.url = `https://github.com/${repo}/releases/download/v${target}/${to}`;
    renames.push({ from, to });
  }
  if (renames.length === 0)
    throw new Error("manifest names no artifacts to promote");
  return { manifest: next, renames };
}

/**
 * Pending changesets at a commit: every `.changeset/*.md` except the README
 * Changesets ships (config.json lives there too). An rc cut while these are
 * pending would carry a number the Version Packages PR is about to change.
 */
export function pendingChangesetCount(changesetDirEntries) {
  return changesetDirEntries.filter(
    (name) => name.endsWith(".md") && name !== "README.md",
  ).length;
}

/** Text for the promoted GitHub Release. */
export function releaseNotes({
  to,
  targetVersion: target,
  sourceVersion,
  commit,
  repoKind,
}) {
  const hop =
    to === "rc"
      ? `promoted from canary build ${sourceVersion}`
      : `promoted from ${sourceVersion}`;
  const bytes = hasAssets(repoKind)
    ? "Same bytes as the source build; only the asset names, manifest and its signature changed."
    : "Notes-only release (no assets).";
  return `v${target} — ${hop} (commit ${commit}). ${bytes}`;
}

/** GITHUB_OUTPUT lines for a resolved plan. */
export function outputLines(plan) {
  return Object.entries(plan).map(([key, value]) => `${key}=${value}`);
}

// ---------------------------------------------------------------------------
// Versions from tags (Road to 0.2.x, versioning Phase 3). No file and no
// "Start x.y.z" PR decides a repo's next number: its git tags do.
//
//   release  the highest bare `vX.Y.Z` tag (R).
//   base     the number trunk is building now: R's next patch, unless an
//            unreleased `vB-rc.N` tag or a `start/vB` marker (pushed by the
//            daemon repo's "Start Next Version" workflow) names a higher B —
//            then the highest such B. Once B ships, R = B and the base moves
//            on to B's next patch by itself.
//   canary   `<base>-canary.<N>`: N is one past the highest build of that base
//            on the rolling canary release (its `manifest-<version>.json`
//            copies), so it restarts at 1 for every new base. Every canary
//            build runs in a per-repo queue, so two builds never read the
//            same highest N.
// ---------------------------------------------------------------------------

const BARE_VERSION_PARTS_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const RELEASE_TAG_RE = /^v(\d+\.\d+\.\d+)$/;
const RC_TAG_RE = /^v(\d+\.\d+\.\d+)-rc\.(\d+)$/;
const START_TAG_RE = /^start\/v(\d+\.\d+\.\d+)$/;
const CANARY_MANIFEST_RE = /^manifest-(\d+\.\d+\.\d+)-canary\.(\d+)\.json$/;

/** The base a repo with no release at all starts from. */
export const FIRST_VERSION = "0.1.0";

/** What "Start Next Version" can start. */
export const BUMPS = Object.freeze(["minor", "major"]);

function versionParts(version) {
  const m = BARE_VERSION_PARTS_RE.exec(version);
  if (!m) throw new Error(`not a bare X.Y.Z version: ${version}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Numeric X.Y.Z order: negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a, b) {
  const [x, y] = [versionParts(a), versionParts(b)];
  const i = x.findIndex((part, index) => part !== y[index]);
  return i < 0 ? 0 : x[i] - y[i];
}

function highestVersion(versions) {
  let best = null;
  for (const version of versions) {
    if (best === null || compareVersions(version, best) > 0) best = version;
  }
  return best;
}

/** Tag names without refs/tags/, blank lines dropped. */
function tagNames(tags) {
  return tags
    .map((raw) => raw.trim().replace(/^refs\/tags\//, ""))
    .filter((name) => name !== "");
}

function matches(tags, re) {
  return tagNames(tags)
    .map((name) => re.exec(name))
    .filter((m) => m !== null);
}

/** The newest release (highest bare vX.Y.Z tag) without the v, or null. */
export function latestRelease(tags) {
  return highestVersion(matches(tags, RELEASE_TAG_RE).map((m) => m[1]));
}

function isAbove(version, released) {
  return released === null || compareVersions(version, released) > 0;
}

/** The next patch of a bare X.Y.Z. */
export function nextPatch(version) {
  const [major, minor, patch] = versionParts(version);
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * The version trunk is building now (see the block comment above): the
 * newest release's next patch, or the highest unreleased rc / started
 * version above that release when there is one.
 */
export function nextBase(tags) {
  const released = latestRelease(tags);
  const floor = released === null ? FIRST_VERSION : nextPatch(released);
  const inFlight = [...matches(tags, RC_TAG_RE), ...matches(tags, START_TAG_RE)]
    .map((m) => m[1])
    .filter((version) => isAbove(version, released));
  return highestVersion([floor, ...inFlight]);
}

/**
 * The canary number for a base: one past the highest `manifest-<base>-canary.<N>.json`
 * on the rolling canary release (`assetNames`), or 1 when that base has none.
 */
export function nextCanaryNumber(base, assetNames = []) {
  versionParts(base);
  let highest = 0;
  for (const name of assetNames) {
    const m = CANARY_MANIFEST_RE.exec(name.trim());
    if (m && m[1] === base) highest = Math.max(highest, Number(m[2]));
  }
  return highest + 1;
}

/**
 * The rc a Release PR ships: the newest `vB-rc.N` whose B is above the newest
 * release (highest B, then highest N), or null when every rc has shipped.
 */
export function newestUnreleasedRc(tags) {
  const released = latestRelease(tags);
  let best = null;
  for (const m of matches(tags, RC_TAG_RE)) {
    const candidate = { tag: m[0], version: m[1], number: Number(m[2]) };
    if (!isAbove(candidate.version, released)) continue;
    const order =
      best === null ? 1 : compareVersions(candidate.version, best.version);
    if (order > 0 || (order === 0 && candidate.number > best.number)) {
      best = candidate;
    }
  }
  return best;
}

/**
 * What "Start Next Version" does for one repo: the next minor or major after
 * that repo's newest release (`target`), and whether the repo's base is
 * already there or past it (`started`: then nothing is pushed).
 */
export function startTarget(bump, tags) {
  if (!BUMPS.includes(bump)) {
    throw new Error(
      `bump must be one of ${BUMPS.join("|")}, got ${JSON.stringify(bump)}`,
    );
  }
  const released = latestRelease(tags);
  const [major, minor] = versionParts(released ?? "0.0.0");
  const target =
    bump === "major" ? `${major + 1}.0.0` : `${major}.${minor + 1}.0`;
  const base = nextBase(tags);
  return {
    released: released ?? "",
    target,
    base,
    started: compareVersions(base, target) >= 0,
  };
}

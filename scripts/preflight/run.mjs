// Orchestration for the launch preflight. It asks GitHub's REST API (GET only)
// and public HTTPS for facts and turns them into green / amber / red rows
// with the pure functions in lib.mjs.
//
// `io` is the only way out of this module and it has two read methods:
//   io.api(path)      GET https://api.github.com<path>, parsed JSON; throws an error with .status on failure
//   io.download(url)  GET a public URL, parsed JSON, or null when it does not answer
// Nothing here can write, and nothing talks to a server of ours.

import {
  canaryManifests,
  canaryRow,
  checksRow,
  environmentRows,
  findReleasePr,
  hostedRow,
  latestReleaseVersion,
  manifestRow,
  ORG,
  prFreshRow,
  prStateRow,
  REPOS,
  row,
  short,
  summariseChecks,
  versionRows,
} from "./lib.mjs";

/** The canary rail keeps this many builds, so looking further back is pointless. */
export const CANARY_RAIL = 20;

export const HOSTED = [
  { id: "hosted/staging", label: "hosted staging", url: "https://staging.turbopanel.dev/api/health", branch: "staging" },
  { id: "hosted/live", label: "hosted live", url: "https://turbopanel.app/api/health", branch: "live" },
];

async function checkRuns(io, repo, sha) {
  const runs = [];
  for (let page = 1; page <= 3; page += 1) {
    const body = await io.api(`/repos/${ORG}/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`);
    runs.push(...body.check_runs);
    if (runs.length >= body.total_count) break;
  }
  return summariseChecks(runs);
}

/** Download canary manifests newest first until one names `headSha` (or the rail ends). */
async function canaryCommits(io, repo, names, headSha) {
  const found = [];
  for (const entry of names.slice(0, CANARY_RAIL)) {
    const manifest = await io.download(`https://github.com/${ORG}/${repo}/releases/download/canary/${entry.name}`);
    found.push({ ...entry, commit: manifest?.commit ?? "" });
    if (manifest?.commit === headSha) break;
  }
  return found;
}

async function optionalApi(io, path) {
  try {
    return await io.api(path);
  } catch (error) {
    if ([401, 403, 404].includes(error?.status)) return null;
    throw error;
  }
}

async function canaryRows(io, repo, label, rcPr, trunkSha) {
  const rail = await optionalApi(io, `/repos/${ORG}/${repo}/releases/tags/canary`);
  const names = canaryManifests((rail?.assets ?? []).map((asset) => asset.name));
  const rows = [];
  const newest = await canaryCommits(io, repo, names.slice(0, 1), trunkSha);
  if (newest.length === 0) {
    rows.push(row(`${repo}/canary-latest`, "red", `${label}: no canary published yet`));
  } else if (newest[0].commit === trunkSha) {
    rows.push(row(`${repo}/canary-latest`, "green", `${label}: latest canary ${newest[0].base}-canary.${newest[0].number} is built from trunk ${short(trunkSha)}`));
  } else {
    rows.push(row(`${repo}/canary-latest`, "amber", `${label}: latest canary ${newest[0].base}-canary.${newest[0].number} is ${short(newest[0].commit)}, trunk is ${short(trunkSha)} (a build may be running)`));
  }
  if (rcPr !== null) {
    const manifests = await canaryCommits(io, repo, names, rcPr.head.sha);
    rows.push(canaryRow(`${repo}/canary-for-rc`, `${label} Release Candidate`, { headSha: rcPr.head.sha, rcVersion: rcPr.version, manifests }));
  }
  return rows;
}

async function manifestRows(io, repo, label, latest) {
  const rows = [];
  const base = `https://github.com/${ORG}/${repo}/releases`;
  const rc = await io.download(`${base}/download/rc/manifest.json`);
  const release = await io.download(`${base}/latest/download/manifest.json`);
  rows.push(manifestRow(`${repo}/manifest-rc`, `${label} rc channel`, rc));
  rows.push(manifestRow(`${repo}/manifest-release`, `${label} release channel`, release));
  if (rc !== null && release !== null && rc.version === release.version) {
    rows.push(row(`${repo}/rc-is-release`, "info", `${label}: the rc pointer names ${rc.version}, the same as the release channel (normal until a new RC publishes)`));
  }
  if (release !== null && latest !== null && release.version !== latest) {
    rows.push(row(`${repo}/release-latest`, "amber", `${label}: release manifest says ${release.version} but the newest release tag is v${latest}`));
  }
  return rows;
}

async function environmentRowsFor(io, repo, kind) {
  const body = await optionalApi(io, `/repos/${ORG}/${repo}/environments`);
  const envs = body === null ? null : body.environments.map((env) => env.name);
  let releaseRules = null;
  if (envs?.includes("release")) {
    const release = await optionalApi(io, `/repos/${ORG}/${repo}/environments/release`);
    releaseRules = release === null ? null : release.protection_rules.map((rule) => rule.type);
  }
  return environmentRows(repo, envs, releaseRules, kind);
}

async function repoRows(io, { name, kind, label }) {
  const rows = [];
  const prs = await io.api(`/repos/${ORG}/${name}/pulls?state=open&per_page=100`);
  const rcPr = findReleasePr(prs, "rc");
  const releasePr = findReleasePr(prs, "release");
  const trunk = await io.api(`/repos/${ORG}/${name}/commits/trunk`);
  const trunkSha = trunk.sha;

  let rcSummary = null;
  if (rcPr === null) {
    rows.push(row(`${name}/rc-pr`, "amber", `${label}: no Release Candidate PR is open (already merged, or the bot has not opened the next one)`));
  } else {
    const detail = await io.api(`/repos/${ORG}/${name}/pulls/${rcPr.number}`);
    rows.push(row(`${name}/rc-pr`, "info", `${label}: ${name}#${rcPr.number} "${rcPr.title}"`));
    rows.push(prStateRow(`${name}/rc-state`, `${label} ${name}#${rcPr.number}`, detail));
    rows.push(prFreshRow(`${name}/rc-fresh`, `${label} ${name}#${rcPr.number}`, rcPr, trunkSha));
    rcSummary = await checkRuns(io, name, rcPr.head.sha);
    rows.push(checksRow(`${name}/rc-checks`, `${label} ${name}#${rcPr.number}`, rcSummary));
  }
  const trunkSummary = rcPr?.head.sha === trunkSha && rcSummary !== null ? rcSummary : await checkRuns(io, name, trunkSha);
  rows.push(checksRow(`${name}/trunk-checks`, `${label} trunk ${short(trunkSha)}`, trunkSummary));

  if (kind !== "notes-only") rows.push(...(await canaryRows(io, name, label, rcPr, trunkSha)));

  const releases = await io.api(`/repos/${ORG}/${name}/releases?per_page=30`);
  const latest = latestReleaseVersion(releases);
  rows.push(row(`${name}/latest-release`, latest === null ? "red" : "info", latest === null ? `${label}: no release published` : `${label}: newest release is v${latest}`));
  if (kind !== "notes-only") rows.push(...(await manifestRows(io, name, label, latest)));
  rows.push(...(await environmentRowsFor(io, name, kind)));

  if (releasePr !== null) {
    rows.push(row(`${name}/release-pr`, "info", `${label}: ${name}#${releasePr.number} "${releasePr.title}" is open (staging into live); merging it needs the release approval`));
  }
  return { rows, rcVersion: rcPr?.version ?? null, latest };
}

async function hostedRows(io) {
  const rows = [];
  for (const target of HOSTED) {
    const branch = await io.api(`/repos/${ORG}/turbopanel/commits/${target.branch}`);
    rows.push(hostedRow(target.id, target.label, await io.download(target.url), branch.sha));
  }
  return rows;
}

/**
 * Run every check. Returns the rows in reading order. Throws only when GitHub
 * itself cannot be reached (a failed read of a core fact is not a verdict).
 */
export async function runPreflight(io, { hosted = false } = {}) {
  const rows = [];
  const rc = {};
  const latest = {};
  for (const repo of REPOS) {
    const result = await repoRows(io, repo);
    rows.push(...result.rows);
    rc[repo.name] = result.rcVersion;
    latest[repo.name] = result.latest;
  }
  const present = Object.fromEntries(Object.entries(rc).filter(([, version]) => version !== null));
  rows.push(...versionRows(present, latest));
  if (hosted) rows.push(...(await hostedRows(io)));
  return rows;
}

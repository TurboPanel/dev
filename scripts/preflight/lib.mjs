// Pure logic for the launch preflight (scripts/preflight/cli.mjs). Every
// function here takes data in and returns data out: no network, no clock, no
// environment. The CLI fetches (GET only) and hands the answers to these
// functions, so the tests can run on fixtures.
//
// A result row is { id, level, text } where level is one of:
//   green  the item is fine
//   amber  waiting (a check is still running) or unknown (this token cannot see it)
//   red    stop: fix this before merging
//   info   a fact, not a verdict

import { compareVersions } from "../promote/lib.mjs";

export const ORG = "TurboPanel";
export const LEVELS = ["green", "amber", "red", "info"];

/** Repos that ship a release candidate, with what each one publishes. */
export const REPOS = [
  { name: "turbopanel", kind: "instance", label: "control plane" },
  { name: "turbopaneld", kind: "daemon", label: "daemon" },
  { name: "ui", kind: "ui", label: "ui" },
  { name: "website", kind: "notes-only", label: "website" },
];

const TITLE_RE = /^(?:(Release Candidate) (\d+\.\d+\.\d+-rc\.\d+)|(Release) (\d+\.\d+\.\d+))$/;
const CANARY_NAME_RE = /^manifest-(\d+\.\d+\.\d+)-canary\.(\d+)\.json$/;
const OK_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);
// A cancelled run was superseded or stopped by hand: not a failure, but not a pass either.
const WAITING_CONCLUSIONS = new Set(["cancelled", "stale"]);

export function row(id, level, text) {
  return { id, level, text };
}

/** "Release Candidate 0.1.8-rc.1" or "Release 0.1.8" -> { kind, version }, else null. */
export function parseReleasePrTitle(title) {
  const m = TITLE_RE.exec(String(title).trim());
  if (m === null) return null;
  return m[1] === undefined ? { kind: "release", version: m[4] } : { kind: "rc", version: m[2] };
}

/** "0.1.8-rc.1" -> "0.1.8". */
export function baseVersion(version) {
  return String(version).replace(/-.*$/, "");
}

/** Open PRs -> the one release-candidate PR (trunk into staging), or the release PR (staging into live). */
export function findReleasePr(prs, kind) {
  const [base, head] = kind === "rc" ? ["staging", "trunk"] : ["live", "staging"];
  for (const pr of prs) {
    const parsed = parseReleasePrTitle(pr.title);
    if (parsed?.kind === kind && pr.base?.ref === base && pr.head?.ref === head) {
      return { ...pr, version: parsed.version };
    }
  }
  return null;
}

/**
 * Check runs repeat across suites and re-runs: keep the newest run of each
 * name (highest id), then sort the lot into green, waiting and failed.
 * An empty list is "none" (never green: no checks at all is suspicious).
 */
export function summariseChecks(runs) {
  const newest = new Map();
  for (const run of runs) {
    const seen = newest.get(run.name);
    if (seen === undefined || run.id > seen.id) newest.set(run.name, run);
  }
  const names = { green: [], waiting: [], failed: [] };
  for (const run of newest.values()) {
    if (run.status !== "completed") names.waiting.push(run.name);
    else if (WAITING_CONCLUSIONS.has(run.conclusion)) names.waiting.push(`${run.name} (${run.conclusion})`);
    else if (OK_CONCLUSIONS.has(run.conclusion)) names.green.push(run.name);
    else names.failed.push(`${run.name} (${run.conclusion})`);
  }
  let verdict = "green";
  if (names.failed.length > 0) verdict = "failed";
  else if (names.waiting.length > 0) verdict = "waiting";
  else if (newest.size === 0) verdict = "none";
  // A skipped or neutral "ci-ok" is not the gate passing: only success counts.
  return { verdict, total: newest.size, ...names, hasCiOk: newest.get("ci-ok")?.conclusion === "success" };
}

/** A checks summary as a result row. */
export function checksRow(id, subject, summary) {
  const { verdict, total } = summary;
  if (verdict === "failed") {
    return row(id, "red", `${subject}: failing checks: ${summary.failed.join(", ")}`);
  }
  if (verdict === "waiting") {
    return row(id, "amber", `${subject}: not finished: ${summary.waiting.join(", ")}`);
  }
  if (verdict === "none") return row(id, "amber", `${subject}: no checks reported yet`);
  if (!summary.hasCiOk) {
    return row(id, "amber", `${subject}: ${total} checks green but no "ci-ok" among them`);
  }
  return row(id, "green", `${subject}: all ${total} checks green`);
}

/** Release assets -> canary manifests as { name, base, number }, newest first (numeric, so .10 beats .9). */
export function canaryManifests(assetNames) {
  const found = [];
  for (const name of assetNames) {
    const m = CANARY_NAME_RE.exec(name);
    if (m !== null) found.push({ name, base: m[1], number: Number(m[2]) });
  }
  return found.sort((a, b) => compareVersions(b.base, a.base) || b.number - a.number);
}

/**
 * The canary rail and a release candidate. `manifests` carries each canary's
 * name and the commit it was built from ({ name, base, number, commit }).
 * publish-rc needs a canary built from exactly the merged commit, and the
 * rail keeps only the newest 20.
 */
export function canaryRow(id, subject, { headSha, rcVersion, manifests }) {
  if (manifests.length === 0) return row(id, "red", `${subject}: the canary rail has no manifest at all`);
  const hit = manifests.find((m) => m.commit === headSha);
  const newest = manifests[0];
  if (hit === undefined) {
    return row(
      id,
      "red",
      `${subject}: no canary was built from ${short(headSha)} (newest canary ${newest.base}-canary.${newest.number} is ${short(newest.commit)}); publish-rc would fail`,
    );
  }
  const wanted = baseVersion(rcVersion);
  if (hit.base !== wanted) {
    return row(id, "red", `${subject}: canary ${hit.base}-canary.${hit.number} does not match the PR version ${wanted}`);
  }
  const latest = hit === newest ? "the newest canary" : `canary ${newest.number} is newer`;
  return row(id, "green", `${subject}: canary ${hit.base}-canary.${hit.number} was built from ${short(headSha)} (${latest})`);
}

export function short(sha) {
  return String(sha ?? "").slice(0, 8);
}

/** Pull request details -> row about whether GitHub will let it merge. */
export function prStateRow(id, subject, pr) {
  if (pr.draft) return row(id, "red", `${subject}: is a draft`);
  const state = pr.mergeable_state ?? "unknown";
  if (state === "clean") return row(id, "green", `${subject}: GitHub says it is clean to merge`);
  if (state === "unknown" || state === "unstable") {
    return row(id, "amber", `${subject}: merge state is ${state} (GitHub may still be computing or a check is pending)`);
  }
  return row(id, "red", `${subject}: merge state is ${state}`);
}

/** The RC PR must carry today's trunk: if trunk moved on, the RC PR is behind and will refresh. */
export function prFreshRow(id, subject, pr, trunkSha) {
  if (pr.head.sha === trunkSha) return row(id, "green", `${subject}: its head ${short(trunkSha)} is the current trunk head`);
  return row(
    id,
    "amber",
    `${subject}: head ${short(pr.head.sha)} is not the trunk head ${short(trunkSha)}; wait for the bot to refresh it, then recheck`,
  );
}

/** A manifest as served on a channel -> row (resolvable, signed, version). */
export function manifestRow(id, subject, manifest) {
  if (manifest === null) return row(id, "red", `${subject}: manifest does not resolve`);
  const sig = manifest.signature;
  if (sig?.alg !== "ed25519" || !sig.keyId || !sig.value) {
    return row(id, "red", `${subject}: manifest ${manifest.version} is not signed with ed25519`);
  }
  return row(id, "green", `${subject}: manifest ${manifest.version} resolves and carries an ed25519 signature (key ${short(sig.keyId)}); the installer verifies it, this check does not`);
}

/**
 * GitHub environments of a repo -> rows. `envs` is the name list, or null when
 * the token cannot read them. A notes-only repo (website) signs nothing, so it
 * needs no canary or rc environment, and a missing approver there is a choice
 * to confirm rather than a stop.
 */
export function environmentRows(repo, envs, releaseRules, kind = "instance") {
  if (envs === null) {
    return [row(`${repo}/environments`, "amber", `${repo}: this token cannot read the environments, so signing setup is unchecked`)];
  }
  const rows = [];
  const notesOnly = kind === "notes-only";
  for (const name of notesOnly ? ["release"] : ["canary", "rc", "release"]) {
    rows.push(
      envs.includes(name)
        ? row(`${repo}/env-${name}`, "green", `${repo}: signing environment "${name}" exists`)
        : row(`${repo}/env-${name}`, "red", `${repo}: signing environment "${name}" is missing`),
    );
  }
  if (envs.includes("release") && releaseRules === null) {
    rows.push(row(`${repo}/env-release-gate`, "amber", `${repo}: this token cannot read the "release" approver rule, so the live approval is unchecked`));
  }
  if (envs.includes("release") && releaseRules !== null) {
    rows.push(
      releaseRules.includes("required_reviewers")
        ? row(`${repo}/env-release-gate`, "green", `${repo}: "release" needs a named approver (the live promotion waits for you)`)
        : row(
            `${repo}/env-release-gate`,
            notesOnly ? "amber" : "red",
            `${repo}: "release" has no required approver, so a Release PR would publish unattended${notesOnly ? " (notes only: a GitHub release page, no package; confirm that is what you want)" : ""}`,
          ),
    );
  }
  return rows;
}

/** Version agreement across repos. `rc` maps repo name -> RC PR version (or missing). */
export function versionRows(rc, latest) {
  const rows = [];
  const cp = rc.turbopanel;
  const daemon = rc.turbopaneld;
  if (cp && daemon) {
    rows.push(
      baseVersion(cp) === baseVersion(daemon)
        ? row("versions/instance-daemon", "green", `control plane ${cp} and daemon ${daemon} are the same version`)
        : row("versions/instance-daemon", "red", `control plane ${cp} and daemon ${daemon} differ; they ship together`),
    );
  }
  if (rc.ui && rc.website) {
    rows.push(
      baseVersion(rc.ui) === baseVersion(rc.website)
        ? row("versions/ui-website", "green", `ui ${rc.ui} and website ${rc.website} are the same version`)
        : row("versions/ui-website", "amber", `ui ${rc.ui} and website ${rc.website} differ (they have matched so far)`),
    );
  }
  for (const [name, version] of Object.entries(rc)) {
    const released = latest[name];
    if (!version || !released) continue;
    rows.push(
      compareVersions(baseVersion(version), baseVersion(released)) > 0
        ? row(`versions/${name}-next`, "green", `${name}: ${version} is ahead of the released ${released}`)
        : row(`versions/${name}-next`, "red", `${name}: ${version} is not ahead of the released ${released}`),
    );
  }
  return rows;
}

/** Newest non-prerelease tag from a releases list ("v0.1.7" -> "0.1.7"), or null. */
export function latestReleaseVersion(releases) {
  let best = null;
  for (const rel of releases) {
    const m = /^v(\d+\.\d+\.\d+)$/.exec(rel.tag_name ?? "");
    if (rel.draft || rel.prerelease) continue;
    if (m !== null && (best === null || compareVersions(m[1], best) > 0)) best = m[1];
  }
  return best;
}

/**
 * Hosted health answer (opt-in, public GET) -> row. The revision commit must
 * be what the branch holds once Workers Builds has deployed.
 */
export function hostedRow(id, subject, health, branchSha) {
  if (health === null) return row(id, "red", `${subject}: /api/health did not answer`);
  const commit = health.revision?.commit ?? "";
  const facts = `environment ${health.environment ?? "?"}, version ${health.version ?? "?"}, commit ${short(commit)}`;
  if (branchSha && commit !== branchSha) {
    return row(id, "amber", `${subject}: ${facts}; the branch holds ${short(branchSha)} (deploy not finished, or not this one)`);
  }
  return row(id, "info", `${subject}: ${facts}`);
}

/** Count rows by level and decide the exit code (1 when anything is red). */
export function summarise(rows) {
  const counts = { green: 0, amber: 0, red: 0, info: 0 };
  for (const r of rows) counts[r.level] += 1;
  return { counts, ok: counts.red === 0, goForMerge: counts.red === 0 && counts.amber === 0 };
}

const COLOURS = { green: "\u001b[32m", amber: "\u001b[33m", red: "\u001b[31m", info: "\u001b[36m" };
const WORDS = { green: "GREEN", amber: "AMBER", red: "RED  ", info: "INFO " };

/** One printable line per row; colour only when asked for. */
export function formatRow(r, colour = false) {
  const word = colour ? `${COLOURS[r.level]}${WORDS[r.level]}\u001b[0m` : WORDS[r.level];
  return `${word}  ${r.text}`;
}

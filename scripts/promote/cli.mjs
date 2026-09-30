#!/usr/bin/env node
// Thin shell over lib.mjs for .github/workflows/gh-promote.yml. Every
// command reads its arguments explicitly (no ambient env beyond the
// GITHUB_OUTPUT path) and exits non-zero with a `::error::` line so the
// workflow step fails with the reason on it.
//
//   node cli.mjs plan --to rc --source <id|version|manifest-x.json> --repo-kind daemon \
//       [--canary-assets <file with one asset name per line>] [--existing-tags <file with one tag per line>]
//   node cli.mjs verify --manifest <path> --assets-dir <dir>
//   node cli.mjs rewrite --manifest <path> --assets-dir <dir> --repo O/R --to rc \
//       --source-version X --target-version Y --out <path>
//   node cli.mjs changesets --to rc --listing <file with .changeset entries, one per line>
//   node cli.mjs base --tags <file with one tag or refs/tags/ ref per line>
//   node cli.mjs canary-version --tags <file> --canary-assets <file with one asset name per line>
//   node cli.mjs release-rc --tags <file>
//   node cli.mjs start --bump minor|major --tags <file>
//   node cli.mjs notes --to rc --repo-kind daemon --source-version X --target-version Y --commit SHA
import { createHash } from "node:crypto";
import {
  appendFileSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  artifactMismatches,
  assertRepoKind,
  assertTarget,
  BRANCH_FOR_TARGET,
  findCanaryManifestAsset,
  hasAssets,
  latestRelease,
  nextBase,
  nextCanaryNumber,
  newestUnreleasedRc,
  outputLines,
  parseSource,
  pendingChangesetCount,
  releaseNotes,
  rewriteManifest,
  startTarget,
  targetVersion,
} from "./lib.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error(`unexpected argument ${key}`);
    args[key.slice(2)] = argv[i + 1] ?? "";
    i += 1;
  }
  return args;
}

function required(args, name) {
  const value = args[name];
  if (value === undefined || value === "")
    throw new Error(`--${name} is required`);
  return value;
}

function lines(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** Tag names already in the repo (--existing-tags <file>, one per line); none when omitted. */
function existingTags(args) {
  return args["existing-tags"] ? lines(args["existing-tags"]) : [];
}

function emit(plan) {
  const out = outputLines(plan);
  for (const line of out) console.log(line);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `${out.join("\n")}\n`);
}

function plan(args) {
  const to = assertTarget(required(args, "to"));
  const repoKind = assertRepoKind(required(args, "repo-kind"));
  const source = parseSource(to, required(args, "source"));
  const result = { to, "repo-kind": repoKind, branch: BRANCH_FOR_TARGET[to] };
  if (source.kind === "rc-tag") {
    result["source-version"] = source.version;
    result["source-tag"] = source.tag;
  } else if (!hasAssets(repoKind)) {
    throw new Error(
      "a notes-only repo has no canary release; pass --source-version",
    );
  } else if (source.kind === "canary-build-id") {
    const asset = findCanaryManifestAsset(
      lines(required(args, "canary-assets")),
      source.buildId,
    );
    result["source-version"] = asset.slice("manifest-".length, -".json".length);
    result["source-asset"] = asset;
  } else {
    result["source-version"] = source.version;
    result["source-asset"] = source.asset;
  }
  result["target-version"] = targetVersion(
    to,
    result["source-version"],
    existingTags(args),
  );
  result.tag = `v${result["target-version"]}`;
  emit(result);
}

function planNotesOnly(args) {
  // Notes-only rc: the source is a commit, the number is the repo's base
  // (`base`, from its tags) at the time of the promotion.
  const to = assertTarget(required(args, "to"));
  const sourceVersion = required(args, "source-version");
  const target = targetVersion(to, sourceVersion, existingTags(args));
  emit({
    to,
    "repo-kind": "notes-only",
    branch: BRANCH_FOR_TARGET[to],
    "source-version": sourceVersion,
    "target-version": target,
    tag: `v${target}`,
  });
}

function digests(dir) {
  const files = new Map();
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isFile()) continue;
    const data = readFileSync(path);
    files.set(name, {
      sha256: createHash("sha256").update(data).digest("hex"),
      size: data.length,
    });
  }
  return files;
}

function verify(args) {
  const manifest = JSON.parse(readFileSync(required(args, "manifest"), "utf8"));
  const problems = artifactMismatches(
    manifest,
    digests(required(args, "assets-dir")),
  );
  if (problems.length > 0) throw new Error(problems.join("\n"));
  console.log(`source assets match the manifest (commit ${manifest.commit})`);
}

function rewrite(args) {
  const manifestPath = required(args, "manifest");
  const assetsDir = required(args, "assets-dir");
  const to = assertTarget(required(args, "to"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const { manifest: next, renames } = rewriteManifest(manifest, {
    repo: required(args, "repo"),
    sourceVersion: required(args, "source-version"),
    targetVersion: required(args, "target-version"),
    channel: to,
  });
  for (const { from, to: target } of renames) {
    renameSync(join(assetsDir, from), join(assetsDir, target));
    console.log(`renamed ${from} -> ${target}`);
  }
  writeFileSync(required(args, "out"), `${JSON.stringify(next, null, 2)}\n`);
}

function changesets(args) {
  const to = assertTarget(required(args, "to"));
  const pending = pendingChangesetCount(lines(required(args, "listing")));
  if (to === "rc" && pending > 0) {
    throw new Error(
      `${pending} changeset(s) are pending at the source commit; merge the Version Packages PR and promote the canary it produces`,
    );
  }
  console.log(`${pending} pending changeset(s)`);
}

function notes(args) {
  process.stdout.write(
    releaseNotes({
      to: assertTarget(required(args, "to")),
      repoKind: assertRepoKind(required(args, "repo-kind")),
      sourceVersion: required(args, "source-version"),
      targetVersion: required(args, "target-version"),
      commit: required(args, "commit"),
    }),
  );
}

/** The repo's newest release and the base trunk is building now. */
function base(args) {
  const tags = lines(required(args, "tags"));
  emit({ release: latestRelease(tags) ?? "", base: nextBase(tags) });
}

/** The next canary: the base plus its counter from the rolling canary release. */
function canaryVersion(args) {
  const tags = lines(required(args, "tags"));
  const version = nextBase(tags);
  const assets = args["canary-assets"] ? lines(args["canary-assets"]) : [];
  const number = nextCanaryNumber(version, assets);
  emit({ base: version, number, version: `${version}-canary.${number}` });
}

/** The rc a Release PR ships (empty when every rc has shipped). */
function releaseRc(args) {
  const rc = newestUnreleasedRc(lines(required(args, "tags")));
  emit({ "rc-tag": rc?.tag ?? "", version: rc?.version ?? "" });
}

/** What "Start Next Version" would start in this repo. */
function start(args) {
  emit(startTarget(required(args, "bump"), lines(required(args, "tags"))));
}

const COMMANDS = {
  base,
  "canary-version": canaryVersion,
  "release-rc": releaseRc,
  start,
  plan,
  "plan-notes-only": planNotesOnly,
  verify,
  rewrite,
  changesets,
  notes,
};

try {
  const [command, ...rest] = process.argv.slice(2);
  const run = COMMANDS[command];
  if (!run)
    throw new Error(
      `usage: cli.mjs <${Object.keys(COMMANDS).join("|")}> --key value ...`,
    );
  run(parseArgs(rest));
} catch (error) {
  console.error(
    `::error::promote: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

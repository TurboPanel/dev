#!/usr/bin/env node
// Thin shell over lib.mjs for .github/workflows/gh-promote.yml. Every
// command reads its arguments explicitly (no ambient env beyond the
// GITHUB_OUTPUT path) and exits non-zero with a `::error::` line so the
// workflow step fails with the reason on it.
//
//   node cli.mjs plan --to rc --source <id|version|manifest-x.json> --repo-kind daemon \
//       [--canary-assets <file with one asset name per line>] [--source-version X]
//   node cli.mjs verify --manifest <path> --assets-dir <dir>
//   node cli.mjs rewrite --manifest <path> --assets-dir <dir> --repo O/R --to rc \
//       --source-version X --target-version Y --out <path>
//   node cli.mjs changesets --to rc --listing <file with .changeset entries, one per line>
//   node cli.mjs notes --to rc --repo-kind daemon --source-version X --target-version Y --commit SHA
import { createHash } from "node:crypto";
import { appendFileSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  if (value === undefined || value === "") throw new Error(`--${name} is required`);
  return value;
}

function lines(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function emit(plan) {
  const out = outputLines(plan);
  for (const line of out) console.log(line);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${out.join("\n")}\n`);
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
    throw new Error("a notes-only repo has no canary release; pass --source-version");
  } else if (source.kind === "canary-build-id") {
    const asset = findCanaryManifestAsset(lines(required(args, "canary-assets")), source.buildId);
    result["source-version"] = asset.slice("manifest-".length, -".json".length);
    result["source-asset"] = asset;
  } else {
    result["source-version"] = source.version;
    result["source-asset"] = source.asset;
  }
  result["target-version"] = targetVersion(to, result["source-version"]);
  result.tag = `v${result["target-version"]}`;
  emit(result);
}

function planNotesOnly(args) {
  // Notes-only rc: the source is a commit, the number comes from its package.json.
  const to = assertTarget(required(args, "to"));
  const sourceVersion = required(args, "source-version");
  const target = targetVersion(to, sourceVersion);
  emit({ to, "repo-kind": "notes-only", branch: BRANCH_FOR_TARGET[to], "source-version": sourceVersion, "target-version": target, tag: `v${target}` });
}

function digests(dir) {
  const files = new Map();
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isFile()) continue;
    const data = readFileSync(path);
    files.set(name, { sha256: createHash("sha256").update(data).digest("hex"), size: data.length });
  }
  return files;
}

function verify(args) {
  const manifest = JSON.parse(readFileSync(required(args, "manifest"), "utf8"));
  const problems = artifactMismatches(manifest, digests(required(args, "assets-dir")));
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

const COMMANDS = { plan, "plan-notes-only": planNotesOnly, verify, rewrite, changesets, notes };

try {
  const [command, ...rest] = process.argv.slice(2);
  const run = COMMANDS[command];
  if (!run) throw new Error(`usage: cli.mjs <${Object.keys(COMMANDS).join("|")}> --key value ...`);
  run(parseArgs(rest));
} catch (error) {
  console.error(`::error::promote: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

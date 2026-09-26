// Types for lib.mjs so src/lib/promote.test.ts typechecks without allowJs.

export type PromoteTarget = "rc" | "release";
export type RepoKind = "daemon" | "instance" | "ui" | "notes-only";

export interface ArtifactEntry {
  url: string;
  sha256: string;
  size: number;
}

export interface FileDigest {
  sha256: string;
  size: number;
}

export interface Rename {
  from: string;
  to: string;
}

export type ParsedSource =
  | { kind: "rc-tag"; version: string; tag: string }
  | { kind: "canary-build-id"; buildId: string }
  | { kind: "canary-version"; version: string; buildId: string; asset: string };

export const CANARY_BUILD_ID_RE: RegExp;
export const TARGETS: readonly PromoteTarget[];
export const REPO_KINDS: readonly RepoKind[];
export const BRANCH_FOR_TARGET: Readonly<Record<PromoteTarget, "staging" | "live">>;

export function hasAssets(repoKind: string): boolean;
export function assertTarget(to: string): PromoteTarget;
export function assertRepoKind(repoKind: string): RepoKind;
export function targetVersion(to: string, sourceVersion: string): string;
export function parseSource(to: string, source: string): ParsedSource;
export function findCanaryManifestAsset(assetNames: string[], buildId: string): string;
export function walkArtifactEntries(
  node: unknown,
  path?: string,
): Array<{ path: string; entry: ArtifactEntry }>;
export function assetFilename(url: string): string;
export function artifactMismatches(
  manifest: Record<string, unknown>,
  files: Map<string, FileDigest>,
): string[];
export function rewriteManifest(
  manifest: Record<string, unknown>,
  options: { repo: string; sourceVersion: string; targetVersion: string; channel: string },
): { manifest: Record<string, unknown>; renames: Rename[] };
export function pendingChangesetCount(changesetDirEntries: string[]): number;
export function releaseNotes(options: {
  to: string;
  targetVersion: string;
  sourceVersion: string;
  commit: string;
  repoKind: string;
}): string;
export function outputLines(plan: Record<string, string | number>): string[];

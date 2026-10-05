// Types for lib.mjs and run.mjs so src/lib/preflight.test.ts typechecks without allowJs.

export type Level = "green" | "amber" | "red" | "info";
export interface Row {
  id: string;
  level: Level;
  text: string;
}
export interface RepoInfo {
  name: string;
  kind: string;
  label: string;
}
export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
}
export interface ChecksSummary {
  verdict: "green" | "waiting" | "failed" | "none";
  total: number;
  green: string[];
  waiting: string[];
  failed: string[];
  hasCiOk: boolean;
}
export interface CanaryManifest {
  name: string;
  base: string;
  number: number;
  commit?: string;
}
export interface PrLike {
  number?: number;
  title: string;
  draft?: boolean;
  mergeable_state?: string;
  base?: { ref: string };
  head: { ref?: string; sha: string };
}

export const ORG: string;
export const LEVELS: readonly Level[];
export const REPOS: readonly RepoInfo[];
export function row(id: string, level: Level, text: string): Row;
export function parseReleasePrTitle(title: string): { kind: "rc" | "release"; version: string } | null;
export function baseVersion(version: string): string;
export function findReleasePr(prs: readonly PrLike[], kind: "rc" | "release"): (PrLike & { version: string }) | null;
export function summariseChecks(runs: readonly CheckRun[]): ChecksSummary;
export function checksRow(id: string, subject: string, summary: ChecksSummary): Row;
export function canaryManifests(assetNames: readonly string[]): CanaryManifest[];
export function canaryRow(
  id: string,
  subject: string,
  input: { headSha: string; rcVersion: string; manifests: readonly CanaryManifest[] },
): Row;
export function short(sha: string | undefined): string;
export function prStateRow(id: string, subject: string, pr: PrLike): Row;
export function prFreshRow(id: string, subject: string, pr: PrLike, trunkSha: string): Row;
export function manifestRow(
  id: string,
  subject: string,
  manifest: { version: string; signature?: { alg?: string; keyId?: string; value?: string } } | null,
): Row;
export function environmentRows(repo: string, envs: readonly string[] | null, releaseRules: readonly string[] | null, kind?: string): Row[];
export function versionRows(rc: Record<string, string>, latest: Record<string, string | null>): Row[];
export function latestReleaseVersion(releases: readonly { tag_name?: string }[]): string | null;
export function hostedRow(
  id: string,
  subject: string,
  health: { environment?: string; version?: string; revision?: { commit?: string } } | null,
  branchSha?: string,
): Row;
export function summarise(rows: readonly Row[]): {
  counts: Record<Level, number>;
  ok: boolean;
  goForMerge: boolean;
};
export function formatRow(r: Row, colour?: boolean): string;

export interface Io {
  api(path: string): Promise<any>;
  download(url: string): Promise<any>;
}

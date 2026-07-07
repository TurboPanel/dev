import {
  spawnSync,
  type SpawnSyncOptions,
  type SpawnSyncReturns,
} from "node:child_process";

/** FHS system dirs only — subprocesses must not inherit a user-writable PATH (typescript:S4036). */
export const TRUSTED_SYSTEM_PATH = [
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin",
].join(":");

export function trustedSpawnEnv(
  extra?: Record<string, string>,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extra,
    PATH: TRUSTED_SYSTEM_PATH,
  };
}

export function spawnSyncTrusted(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions & { encoding: BufferEncoding },
): SpawnSyncReturns<string>;
export function spawnSyncTrusted(
  command: string,
  args: readonly string[],
  options?: SpawnSyncOptions,
): SpawnSyncReturns<Buffer>;
export function spawnSyncTrusted(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions = {},
): SpawnSyncReturns<Buffer | string> {
  const { env: extraEnv, ...rest } = options;
  return spawnSync(command, args, {
    ...rest,
    env: trustedSpawnEnv(extraEnv as Record<string, string> | undefined),
  });
}

/** Like {@link spawnSyncTrusted} but always decodes stdout/stderr as UTF-8 text. */
export function spawnSyncTrustedText(
  command: string,
  args: readonly string[],
  options: Omit<SpawnSyncOptions, "encoding"> = {},
): SpawnSyncReturns<string> {
  return spawnSyncTrusted(command, args, { ...options, encoding: "utf8" });
}

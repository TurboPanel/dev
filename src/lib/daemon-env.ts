import {
  buildPlatformRepoEntries,
  DAEMON_ENV_PATH,
  DAEMON_ENV_TRUNK_BRANCH_KEY,
  devOrchestrationDir,
  platformCaCertPath,
  resolveDevRoot,
  TURBOPANEL_TRUNK_BRANCH,
} from "./paths.ts";
import { resolveDevIdentity } from "./dev-identity.ts";
import {
  mergeEnvFile,
  parseEnvEntries,
  readEnvFile,
} from "./env-file.ts";
import { caddyBrowserUrl } from "./service-urls.ts";

const INSTANCE_OPT_IN_KEY = "TURBOPANEL_DEV_INSTANCE";
const RUNTIME_KEY = "TURBOPANEL_INSTANCE_RUNTIME";
const WORKERS_INSTANCE_URL_KEYS = [
  "TURBOPANEL_INSTANCE_URL",
  "TURBOPANEL_INSTANCE_CA",
] as const;

/** Build the managed daemon.env entries the dev console writes (testable contract). */
export function buildDaemonBaseEnvEntries(
  extra?: Record<string, string>,
): Record<string, string> {
  const dev = resolveDevIdentity();
  return {
    TURBOPANEL_MODE: "development",
    TURBOPANEL_DEV_ROOT: resolveDevRoot(),
    TURBOPANEL_DEV_ORCHESTRATION_DIR: devOrchestrationDir(),
    ...buildPlatformRepoEntries(),
    [DAEMON_ENV_TRUNK_BRANCH_KEY]: TURBOPANEL_TRUNK_BRANCH,
    TURBOPANEL_DEV_USER: dev.user,
    TURBOPANEL_DEV_UID: String(dev.uid),
    TURBOPANEL_DEV_GID: String(dev.gid),
    ...extra,
  };
}

function buildDaemonBaseEntries(extra?: Record<string, string>): Record<string, string> {
  return buildDaemonBaseEnvEntries(extra);
}

function mergeDaemonEnv(
  entries: Record<string, string>,
  options?: { removeKeys?: string[] },
): void {
  mergeEnvFile(DAEMON_ENV_PATH, entries, options);
}

/** Write co-located dev identity keys without the instance activation marker. */
export function writeDaemonBaseEnv(extra?: Record<string, string>): void {
  mergeDaemonEnv(buildDaemonBaseEntries(extra), {
    removeKeys: [INSTANCE_OPT_IN_KEY],
  });
}

function resolveRuntimeForWrite(
  extra?: Record<string, string>,
): "deno" | "workers" {
  if (extra?.[RUNTIME_KEY] === "workers") {
    return "workers";
  }
  if (extra?.[RUNTIME_KEY] === "deno") {
    return "deno";
  }
  return readInstanceRuntime();
}

/**
 * Opt in to co-located instance provisioning via the daemon `.env` marker.
 *
 * Also applies runtime-aware daemon connectivity: workers mode writes
 * `TURBOPANEL_INSTANCE_URL` + `TURBOPANEL_INSTANCE_CA`; deno mode removes them
 * so the daemon falls back to the local Unix socket.
 */
export function writeDaemonInstanceEnv(extra?: Record<string, string>): void {
  const runtime = resolveRuntimeForWrite(extra);
  const entries: Record<string, string> = {
    ...buildDaemonBaseEntries(),
    [INSTANCE_OPT_IN_KEY]: "1",
    ...extra,
  };
  const removeKeys: string[] = [];

  if (runtime === "workers") {
    entries.TURBOPANEL_INSTANCE_URL = caddyBrowserUrl();
    entries.TURBOPANEL_INSTANCE_CA = platformCaCertPath();
  } else {
    removeKeys.push(...WORKERS_INSTANCE_URL_KEYS);
  }

  mergeDaemonEnv(entries, { removeKeys });
}

function readDaemonEnvEntries(): Map<string, string> {
  return parseEnvEntries(readEnvFile(DAEMON_ENV_PATH));
}

export function readInstanceRuntime(): "deno" | "workers" {
  const runtime = readDaemonEnvEntries().get("TURBOPANEL_INSTANCE_RUNTIME");
  return runtime === "workers" ? "workers" : "deno";
}

export function isDevInstanceEnabled(): boolean {
  return readDaemonEnvEntries().get(INSTANCE_OPT_IN_KEY) === "1";
}

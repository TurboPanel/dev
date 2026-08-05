import { existsSync } from "node:fs";
import { isDaemonSystemdInstalled } from "../dev-services.ts";
import { lookupHostDenoBin } from "./daemon-exec.ts";
import { isDevInstanceEnabled } from "./daemon-env.ts";
import {
  ANSIBLE_PLAYBOOK_BIN,
  daemonRepoPath,
  DEV_CONVERGE_STAMP_PATH,
  VENDORED_DENO_BIN,
} from "./paths.ts";

/** Injectable probes for {@link resolveDevEnvStartupPlan}. */
export type DevEnvReadinessProbe = {
  hasDaemonCheckout: () => boolean;
  hasResolvableDeno: () => boolean;
  hasOrchestrationRuntime: () => boolean;
  hasDaemonSystemdUnit: () => boolean;
  hasDevConvergeStamp: () => boolean;
  isDevInstanceEnabled: () => boolean;
};

/**
 * True when the daemon source checkout path exists.
 *
 * Unlike `isDaemonRepoInstalled` in `dev-services.ts`, this does not fall
 * back to the turbopaneld systemd unit — missing checkout and missing unit
 * are separate bootstrap triggers.
 */
function hasDaemonCheckoutPath(): boolean {
  try {
    return existsSync(daemonRepoPath());
  } catch {
    return false;
  }
}

function hasVendoredDeno(): boolean {
  try {
    return existsSync(VENDORED_DENO_BIN);
  } catch {
    return false;
  }
}

function hasOrchestrationPlaybook(): boolean {
  try {
    return existsSync(ANSIBLE_PLAYBOOK_BIN);
  } catch {
    return false;
  }
}

function hasDevConvergeStamp(): boolean {
  try {
    return existsSync(DEV_CONVERGE_STAMP_PATH);
  } catch {
    return false;
  }
}

const defaultDevEnvReadinessProbe: DevEnvReadinessProbe = {
  hasDaemonCheckout: hasDaemonCheckoutPath,
  hasResolvableDeno: () => lookupHostDenoBin() !== null || hasVendoredDeno(),
  hasOrchestrationRuntime: hasOrchestrationPlaybook,
  hasDaemonSystemdUnit: isDaemonSystemdInstalled,
  hasDevConvergeStamp,
  isDevInstanceEnabled,
};

export type DevEnvStartupAction = "bootstrap" | "converge" | "idle";

export type DevEnvStartupPlan = {
  action: DevEnvStartupAction;
  reasons: string[];
};

/** Env var that disables auto-converge on console launch (any non-empty value). */
export const CONSOLE_NO_AUTO_CONVERGE_ENV = "TURBOPANEL_CONSOLE_NO_AUTO_CONVERGE";

/**
 * True when {@link CONSOLE_NO_AUTO_CONVERGE_ENV} is set to any non-empty value.
 * Bootstrap-on-missing-prereqs is unaffected; only auto-converge is skipped.
 */
export function isConsoleAutoConvergeDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env[CONSOLE_NO_AUTO_CONVERGE_ENV]?.trim());
}

/**
 * Resolve whether the console should full-bootstrap, re-converge, or sit idle
 * for the co-located development environment.
 *
 * Pure/synchronous — all probes are sync filesystem or systemctl checks.
 * Informative stamp / instance-enabled notes are appended when converging;
 * fast-skip of already-converged hosts is handled server-side later via
 * `instance-dev-install --if-needed`. Set
 * {@link CONSOLE_NO_AUTO_CONVERGE_ENV} to skip auto-converge on launch.
 */
export function resolveDevEnvStartupPlan(
  probe: DevEnvReadinessProbe = defaultDevEnvReadinessProbe,
  env: NodeJS.ProcessEnv = process.env,
): DevEnvStartupPlan {
  const reasons: string[] = [];

  if (!probe.hasDaemonCheckout()) {
    reasons.push("daemon checkout missing");
  }
  if (!probe.hasResolvableDeno()) {
    reasons.push("Deno runtime not resolvable");
  }
  if (!probe.hasOrchestrationRuntime()) {
    reasons.push("orchestration runtime (ansible) not installed");
  }
  if (!probe.hasDaemonSystemdUnit()) {
    reasons.push("turbopaneld systemd unit not installed");
  }

  if (reasons.length > 0) {
    return { action: "bootstrap", reasons };
  }

  if (isConsoleAutoConvergeDisabled(env)) {
    reasons.push(`${CONSOLE_NO_AUTO_CONVERGE_ENV} set`);
    return { action: "idle", reasons };
  }

  if (probe.hasDevConvergeStamp()) {
    reasons.push("dev converge previously completed");
  } else {
    reasons.push("no prior dev converge stamp");
  }

  if (probe.isDevInstanceEnabled()) {
    reasons.push("dev instance opt-in enabled");
  } else {
    reasons.push("dev instance opt-in not set");
  }

  return { action: "converge", reasons };
}

import { existsSync } from "node:fs";
import { isDaemonSystemdInstalled } from "../dev-services.ts";
import {
  hostDenoMatchesPin,
  lookupHostDenoBin,
  PINNED_VENDORED_DENO_BIN,
  resolveDenoBinVersion,
} from "./daemon-exec.ts";
import { isDevInstanceEnabled } from "./daemon-env.ts";
import {
  ANSIBLE_PLAYBOOK_BIN,
  daemonRepoPath,
  DENO_VERSION,
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

function pathExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

/**
 * True when the daemon source checkout path exists.
 *
 * Unlike `isDaemonRepoInstalled` in `dev-services.ts`, this does not fall
 * back to the turbopaneld systemd unit — missing checkout and missing unit
 * are separate bootstrap triggers.
 */
function hasDaemonCheckoutPath(): boolean {
  return pathExists(daemonRepoPath());
}

/**
 * True when a Deno the console can actually exec on the pin is already present.
 *
 * Same rules as `resolveBootstrapDenoBin` in `daemon-exec.ts`, and deliberately
 * not a bare existence check: a host Deno counts only while it reports
 * {@link DENO_VERSION}, `vendor/deno/current` counts only once it reports the
 * pin, and otherwise readiness rests on the pinned versioned binary itself. A
 * stale host Deno or a `current` left behind by a superseded pin is not a ready
 * host — it is exactly the drift bootstrap exists to repair, so reporting it as
 * ready would idle the console on a runtime orchestration refuses to use.
 */
function hasPinnedDeno(): boolean {
  const host = lookupHostDenoBin();
  if (host && hostDenoMatchesPin(host)) {
    return true;
  }
  if (pathExists(PINNED_VENDORED_DENO_BIN)) {
    return true;
  }
  return pathExists(VENDORED_DENO_BIN) &&
    resolveDenoBinVersion(VENDORED_DENO_BIN) === DENO_VERSION;
}

function hasOrchestrationPlaybook(): boolean {
  return pathExists(ANSIBLE_PLAYBOOK_BIN);
}

function hasDevConvergeStamp(): boolean {
  return pathExists(DEV_CONVERGE_STAMP_PATH);
}

const defaultDevEnvReadinessProbe: DevEnvReadinessProbe = {
  hasDaemonCheckout: hasDaemonCheckoutPath,
  hasResolvableDeno: hasPinnedDeno,
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

/**
 * Legacy env var — auto-converge on launch is always off; this flag is retained
 * only so older docs/scripts that set it stay harmless.
 */
export const CONSOLE_NO_AUTO_CONVERGE_ENV = "TURBOPANEL_CONSOLE_NO_AUTO_CONVERGE";

/**
 * True when {@link CONSOLE_NO_AUTO_CONVERGE_ENV} is set to any non-empty value.
 * Launch never auto-converges; prefer Developer → Converge instead.
 */
export function isConsoleAutoConvergeDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env[CONSOLE_NO_AUTO_CONVERGE_ENV]?.trim());
}

/**
 * Resolve whether the console should full-bootstrap or sit idle on launch.
 *
 * Pure/synchronous — all probes are sync filesystem or systemctl checks.
 * Missing checkout / Deno / ansible / turbopaneld unit → **bootstrap**.
 * Otherwise → **idle** (no auto-converge). Operators converge explicitly via
 * Developer → Converge / re-converge (optional-services picker first).
 * Post-bootstrap still chains into converge via `handleDaemonInstallDone`.
 */
export function resolveDevEnvStartupPlan(
  probe: DevEnvReadinessProbe = defaultDevEnvReadinessProbe,
  _env: NodeJS.ProcessEnv = process.env,
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

  reasons.push("auto-converge disabled — use Developer → Converge");
  return { action: "idle", reasons };
}

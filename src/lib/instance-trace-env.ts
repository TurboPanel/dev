import {
  mergeEnvFile,
  parseEnvEntries,
  readEnvFile,
} from "./env-file.ts";
import {
  instanceRuntimeDevVarsPath,
  instanceRuntimeEnvPath,
} from "./paths.ts";

const DEBUG_KEY = "TURBOPANEL_DAEMON_DEBUG";

function isDebugEnabledValue(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

export function readCellTraceEnabled(): boolean {
  const runtimeEnv = parseEnvEntries(readEnvFile(instanceRuntimeEnvPath()));
  const runtimeValue = runtimeEnv.get(DEBUG_KEY);
  if (runtimeValue !== undefined) {
    return isDebugEnabledValue(runtimeValue);
  }

  const devVars = parseEnvEntries(readEnvFile(instanceRuntimeDevVarsPath()));
  return isDebugEnabledValue(devVars.get(DEBUG_KEY));
}

export function cellTraceToggleLabel(): string {
  return readCellTraceEnabled()
    ? "Disable verbose cell trace"
    : "Enable verbose cell trace";
}

export function setCellTraceEnabled(enabled: boolean): void {
  const paths = [instanceRuntimeEnvPath(), instanceRuntimeDevVarsPath()];

  for (const path of paths) {
    if (enabled) {
      mergeEnvFile(path, { [DEBUG_KEY]: "1" });
    } else {
      mergeEnvFile(path, {}, { removeKeys: [DEBUG_KEY] });
    }
  }
}

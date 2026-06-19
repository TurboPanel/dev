import { platformRepoPath, TURBOPANEL_ROOT } from "@turbopanel/lib/paths.ts";
import { runInherit } from "@turbopanel/lib/platform-install.ts";

const TURBOPANEL_GROUP = "turbopanel";
const INSTANCE_USER = "instance";
const UI_DIR = platformRepoPath("ui");
const DAEMON_DIR = platformRepoPath("daemon");

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function runSudoScript(script: string): Promise<number> {
  const quiet = await runInherit(["sudo", "-n", "bash", "-c", script]);
  if (quiet === 0) {
    return 0;
  }
  return await runInherit(["sudo", "bash", "-c", script]);
}

/** Expo/Metro writes under ui/.local and ui/.expo; those trees must be instance-owned. */
export async function ensureUiServiceRuntimeDirs(): Promise<void> {
  const normalizeScript = `${DAEMON_DIR}/scripts/normalize-dev-checkout.sh`;
  const script = [
    `set -eu`,
    `ui=${shellQuote(UI_DIR)}`,
    `normalize=${shellQuote(normalizeScript)}`,
    `if [ -x "$normalize" ]; then`,
    `  TURBOPANEL_DEV_USER="$(grep -E '^TURBOPANEL_DEV_USER=' ${shellQuote(`${TURBOPANEL_ROOT}/platform/daemon/.env`)} 2>/dev/null | cut -d= -f2- || true)"`,
    `  TURBOPANEL_DEV_UID="$(grep -E '^TURBOPANEL_DEV_UID=' ${shellQuote(`${TURBOPANEL_ROOT}/platform/daemon/.env`)} 2>/dev/null | cut -d= -f2- || true)"`,
    `  TURBOPANEL_DEV_GID="$(grep -E '^TURBOPANEL_DEV_GID=' ${shellQuote(`${TURBOPANEL_ROOT}/platform/daemon/.env`)} 2>/dev/null | cut -d= -f2- || true)"`,
    `  export TURBOPANEL_DEV_USER TURBOPANEL_DEV_UID TURBOPANEL_DEV_GID`,
    `  "$normalize" "$ui" --ensure-runtime-dirs`,
    `fi`,
    `for dir in "$ui/.local" "$ui/.config" "$ui/.expo"; do`,
    `  install -d -m 2770 -o ${INSTANCE_USER} -g ${TURBOPANEL_GROUP} "$dir"`,
    `done`,
    `find "$ui/.local" "$ui/.config" "$ui/.expo" -xdev -exec chown ${INSTANCE_USER}:${TURBOPANEL_GROUP} {} + 2>/dev/null || true`,
    `find "$ui/.local" "$ui/.config" "$ui/.expo" -type d -exec chmod 2770 {} + 2>/dev/null || true`,
    `if command -v setfacl >/dev/null 2>&1; then`,
    `  setfacl -m g:${TURBOPANEL_GROUP}:rwx "$ui/.expo"`,
    `  setfacl -d -m g:${TURBOPANEL_GROUP}:rwx "$ui/.expo"`,
    `fi`,
  ].join("\n");

  const code = await runSudoScript(script);
  if (code !== 0) {
    throw new Error("Failed to prepare UI runtime directories for turbopanel-ui");
  }
}

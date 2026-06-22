import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEV_ORCHESTRATION_STAGED_DIR,
  TURBOPANEL_ROOT,
} from "./paths.ts";
import { type InstallOutputHandler, runCaptured } from "./install-output.ts";

const TURBOPANEL_USER = "turbopanel";
const TURBOPANEL_GROUP = "turbopanel";

/** Checked-in dev orchestration source tree beside the console checkout. */
export const DEV_ORCHESTRATION_SOURCE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "orchestration",
);

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Copy turbopanel-dev orchestration assets into a stable path under
 * /opt/turbopanel so the turbopanel user can read them during converge.
 */
export async function stageDevOrchestration(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const script = [
    "set -eu",
    `src=${shellQuote(DEV_ORCHESTRATION_SOURCE_DIR)}`,
    `dest=${shellQuote(DEV_ORCHESTRATION_STAGED_DIR)}`,
    `owner=${shellQuote(TURBOPANEL_USER)}`,
    `group=${shellQuote(TURBOPANEL_GROUP)}`,
    '[ -d "$src" ] || { echo "Dev orchestration source missing: $src" >&2; exit 1; }',
    'mkdir -p "$dest"',
    'if command -v rsync >/dev/null 2>&1; then',
    '  rsync -a --delete "$src/" "$dest/"',
    "else",
    '  rm -rf "$dest"/*',
    '  cp -a "$src/." "$dest/"',
    "fi",
    'chown -R "$owner:$group" "$dest"',
    'find "$dest" -type d -exec chmod 755 {} +',
    'find "$dest" -type f -exec chmod 644 {} +',
    `test -f "$dest/dev-converge-manifest.json"`,
    `test -f "$dest/ansible.cfg"`,
  ].join("\n");

  const code = await runCaptured(["sudo", "-n", "bash", "-c", script], onOutput);
  if (code !== 0) {
    throw new Error(
      `Failed to stage dev orchestration from ${DEV_ORCHESTRATION_SOURCE_DIR} to ${DEV_ORCHESTRATION_STAGED_DIR}`,
    );
  }

  onOutput?.(`Staged dev orchestration at ${DEV_ORCHESTRATION_STAGED_DIR}`);
}

/** Best-effort staging refresh; never blocks the TUI. */
export function stageDevOrchestrationQuietly(): void {
  void stageDevOrchestration().catch(() => {
    // Best-effort refresh; never block the TUI.
  });
}

/** Export for tests and permission helpers that need the staged root. */
export { DEV_ORCHESTRATION_STAGED_DIR, TURBOPANEL_ROOT };

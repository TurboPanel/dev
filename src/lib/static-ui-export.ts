import type { InstallOutputHandler } from './install-output.ts'
import { runOrchestrationAction } from './instance-install.ts'

/** Orchestration action arguments for a forced static UI export. */
export const UI_EXPORT_FORCE_ARGS = ['ui-export', '--force'] as const

/**
 * Developer → Rebuild Static UI. Runs the daemon's `ui-export --force` through
 * the same orchestration path as the converge (the `ui-export.yml` playbook as
 * the dev user): it re-exports the web interface without touching units, Caddy
 * or the instance. The daemon makes it a no-op unless the host serves the
 * static UI.
 */
export async function rebuildStaticUi(
  onOutput?: InstallOutputHandler,
  run: typeof runOrchestrationAction = runOrchestrationAction
): Promise<void> {
  onOutput?.('Re-exporting the web interface as a static development build…')
  await run([...UI_EXPORT_FORCE_ARGS], () => {}, onOutput)
  onOutput?.('Static UI rebuilt.')
}

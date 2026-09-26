import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEV_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type SiblingRepo = "turbopanel" | "turbopaneld" | "ui" | "website";

/**
 * A sibling TurboPanel checkout used by cross-repo pin tests.
 *
 * Locally the repos sit side by side, so `<dev>/../<name>`. CI checks the
 * siblings out under `TURBOPANEL_SIBLINGS_DIR` and also sets
 * `TURBOPANEL_REQUIRE_SIBLINGS=1`, which turns a missing checkout into an
 * error instead of `null` — so a skipped cross-repo test can never pass
 * silently in CI.
 */
export function siblingCheckout(
  name: SiblingRepo,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const base = env.TURBOPANEL_SIBLINGS_DIR ?? join(DEV_ROOT, "..");
  const dir = join(base, name);
  if (existsSync(dir)) return dir;
  if (env.TURBOPANEL_REQUIRE_SIBLINGS === "1") {
    throw new Error(
      `sibling checkout ${name} is required but missing at ${dir} (TURBOPANEL_SIBLINGS_DIR=${base})`,
    );
  }
  return null;
}

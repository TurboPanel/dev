import { spawnSync } from "node:child_process";
import { CONFIG_DIR, LOG_DIR, RUNTIMES_DIR, TURBOPANEL_ROOT } from "./paths.ts";
import { tryResolveDevIdentity } from "./dev-identity.ts";
import { type InstallOutputHandler, runCaptured } from "./install-output.ts";

/** Persistent state dir (FHS); dev-owned at runtime like the other trees. */
const STATE_DIR = "/var/lib/turbopanel";

/** FHS trees the dev user should own on co-located dev hosts. */
const FHS_TREES = [TURBOPANEL_ROOT, CONFIG_DIR, STATE_DIR, LOG_DIR] as const;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Dev-only gate. The whole dev stack runs as the single invoking dev user; this
 * flag keeps best-effort ownership/docker backstops from running on production
 * managed hosts (which are provisioned entirely by Ansible).
 */
export function isDevEnvironment(): boolean {
  if (process.env.TURBOPANEL_RUNTIME === "production") {
    return false;
  }
  return tryResolveDevIdentity() !== null;
}

function dockerIsPresent(): boolean {
  if (spawnSync("getent", ["group", "docker"], { stdio: "ignore" }).status === 0) {
    return true;
  }
  if (
    spawnSync("test", ["-S", "/var/run/docker.sock"], { stdio: "ignore" })
      .status === 0
  ) {
    return true;
  }
  return (
    spawnSync("sh", ["-c", "command -v docker >/dev/null 2>&1"], {
      stdio: "ignore",
    }).status === 0
  );
}

/**
 * Best-effort: chown FHS trees to the resolved dev user when they exist but are
 * not yet dev-owned. Covers the window before the first Ansible converge — which
 * is authoritative for ownership — and root-owned artifacts from sudo runtime
 * installers (./console Node, ensureBootstrapDeno).
 *
 * Ownership contract:
 * - **Development:** everything under `/opt/turbopanel` (and the other FHS
 *   mutable dirs) is owned by the invoking dev user + primary group.
 * - **Production:** Ansible `turbopanel-user` owns the install root and vendor
 *   tree as `turbopanel:turbopanel` (uid/gid 9999). This helper never runs there.
 */
export async function ensureFhsTreeOwnership(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  if (!isDevEnvironment()) {
    return;
  }

  const dev = tryResolveDevIdentity();
  if (!dev) {
    return;
  }

  const treePaths = FHS_TREES.map(shellQuote).join(" ");
  const installRoot = shellQuote(TURBOPANEL_ROOT);
  const script = [
    "set -eu",
    `dev=${shellQuote(dev.user)}`,
    `group=${shellQuote(String(dev.gid))}`,
    `for dir in ${treePaths}; do`,
    '  [ -e "$dir" ] || continue',
    '  owner="$(stat -c %U "$dir" 2>/dev/null || true)"',
    '  [ "$owner" = "$dev" ] && continue',
    '  chown "$dev:$group" "$dir" 2>/dev/null || true',
    "done",
    // Sudo runtime installers create root-owned subtrees under /opt/turbopanel;
    // bootstrap and uv/python/ansible writes run as the dev user.
    `if [ -e ${installRoot} ]; then`,
    `  vendor_owner="$(stat -c %U ${shellQuote(RUNTIMES_DIR)} 2>/dev/null || true)"`,
    `  if [ -n "$vendor_owner" ] && [ "$vendor_owner" != "$dev" ]; then`,
    `    chown -R "$dev:$group" ${installRoot}`,
    "  fi",
    "fi",
  ].join("\n");

  await runCaptured(["sudo", "-n", "bash", "-c", script], onOutput);
}

/**
 * Best-effort: add the invoking dev user to the docker group when Docker is
 * installed. The Ansible `docker` role does this on every converge; this is only
 * a pre-first-converge convenience so early docker calls can reach the socket.
 */
export async function ensureDevUserDockerAccess(
  onOutput?: InstallOutputHandler,
): Promise<boolean> {
  const dev = tryResolveDevIdentity();
  if (!dev || !dockerIsPresent()) {
    return false;
  }

  const script = [
    "set -eu",
    `dev=${shellQuote(dev.user)}`,
    'getent group docker >/dev/null 2>&1 || exit 0',
    'members="$(getent group docker | cut -d: -f4 | tr "," " ")"',
    "for member in $members; do",
    '  [ "$member" = "$dev" ] && { echo unchanged; exit 0; }',
    "done",
    'usermod -aG docker "$dev"',
    "echo changed",
  ].join("\n");

  const result = spawnSync("sudo", ["-n", "bash", "-c", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = (result.stdout ?? "").trim();

  if (result.status !== 0) {
    onOutput?.((result.stderr ?? "").trim());
    throw new Error("Failed to add dev user to docker group");
  }

  return output === "changed";
}

/** Best-effort filesystem ownership/docker refresh on console launch; never blocks the TUI. */
export function refreshDevPermissionsQuietly(): void {
  // Dev-only: skip entirely on production hosts (Ansible owns provisioning there).
  if (!isDevEnvironment()) {
    return;
  }

  void (async () => {
    try {
      await ensureFhsTreeOwnership();
      await ensureDevUserDockerAccess();
    } catch {
      // Best-effort refresh; never block the TUI.
    }
  })();
}

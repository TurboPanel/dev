import { spawnSync } from "node:child_process";
import {
  DAEMON_REPO_DIR,
  DEV_ORCHESTRATION_STAGED_DIR,
  RUNTIMES_DIR,
  TURBOPANEL_PLATFORM,
  TURBOPANEL_ROOT,
} from "./paths.ts";
import { tryResolveDevIdentity } from "./dev-identity.ts";
import { type InstallOutputHandler, runCaptured } from "./install-output.ts";
import { aptGetInstall } from "./apt.ts";
import { stageDevOrchestration } from "./dev-orchestration-stage.ts";

const TURBOPANEL_USER = "turbopanel";
const TURBOPANEL_GROUP = "turbopanel";

const STATE_DIRS = [".cache", ".ansible", ".local"] as const;

let turbopanelUserExistsCache: boolean | null = null;
let aclToolEnsured = false;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function resetTurbopanelUserCache(): void {
  turbopanelUserExistsCache = null;
}

export function turbopanelUserExists(): boolean {
  if (turbopanelUserExistsCache !== null) {
    return turbopanelUserExistsCache;
  }
  const result = spawnSync("getent", ["passwd", TURBOPANEL_USER], {
    stdio: "ignore",
  });
  turbopanelUserExistsCache = result.status === 0;
  return turbopanelUserExistsCache;
}

function setfaclAvailable(): boolean {
  return spawnSync("sh", ["-c", "command -v setfacl >/dev/null 2>&1"], {
    stdio: "ignore",
  }).status === 0;
}

/**
 * acl/setfacl is a development-only convenience for granting the dev user write
 * access to platform checkouts. Production managed servers never install the acl
 * package or apply ACLs, so gate every acl/permission helper on this.
 */
export function isDevEnvironment(): boolean {
  if (process.env.TURBOPANEL_RUNTIME === "production") {
    return false;
  }
  return tryResolveDevIdentity() !== null;
}

/** Install the acl package when setfacl is missing (required for dev-user path ACLs). */
async function ensureAclTool(onOutput?: InstallOutputHandler): Promise<void> {
  if (aclToolEnsured || setfaclAvailable()) {
    aclToolEnsured = true;
    return;
  }

  // Never install acl outside development — production hosts must not enable ACLs.
  if (!isDevEnvironment()) {
    return;
  }

  onOutput?.("Install acl (setfacl)");
  const code = await aptGetInstall(["acl"], onOutput);

  if (code !== 0 || !setfaclAvailable()) {
    onOutput?.(
      "Warning: could not install acl; platform access may require a new login",
    );
    return;
  }

  aclToolEnsured = true;
}

function buildStateOwnershipScript(devUser: string | null): string {
  const stateDirPaths = STATE_DIRS.map((dir) => `${TURBOPANEL_ROOT}/${dir}`);
  const aclLines: string[] = [];

  if (devUser) {
    aclLines.push(
      `dev=${shellQuote(devUser)}`,
      'if command -v setfacl >/dev/null 2>&1; then',
      `  for dir in ${stateDirPaths.map(shellQuote).join(" ")}; do`,
      '    [ -d "$dir" ] || continue',
      `    setfacl -m g:${TURBOPANEL_GROUP}:rwx "$dir"`,
      `    setfacl -d -m g:${TURBOPANEL_GROUP}:rwx "$dir"`,
      '    setfacl -m u:$dev:rwx "$dir"',
      '    setfacl -d -m u:$dev:rwx "$dir"',
      "  done",
      "fi",
    );
  } else {
    aclLines.push(
      'if command -v setfacl >/dev/null 2>&1; then',
      `  for dir in ${stateDirPaths.map(shellQuote).join(" ")}; do`,
      '    [ -d "$dir" ] || continue',
      `    setfacl -m g:${TURBOPANEL_GROUP}:rwx "$dir"`,
      `    setfacl -d -m g:${TURBOPANEL_GROUP}:rwx "$dir"`,
      "  done",
      "fi",
    );
  }

  return [
    "set -eu",
    `owner=${shellQuote(TURBOPANEL_USER)}`,
    `group=${shellQuote(TURBOPANEL_GROUP)}`,
    `root=${shellQuote(TURBOPANEL_ROOT)}`,
    `runtimes=${shellQuote(RUNTIMES_DIR)}`,
    'getent passwd "$owner" >/dev/null 2>&1 || exit 1',
    'chown "$owner:$group" "$root"',
    'if [ -d "$runtimes" ]; then chown -R "$owner:$group" "$runtimes"; fi',
    ...STATE_DIRS.map(
      (dir) =>
        `mkdir -p "$root/${dir}" && chown -R "$owner:$group" "$root/${dir}"`,
    ),
    ...STATE_DIRS.map(
      (dir) =>
        `find "$root/${dir}" -xdev -type d -exec chmod 2770 {} + 2>/dev/null || true`,
    ),
    ...aclLines,
  ].join("\n");
}

function buildDevPlatformAccessScript(devUser: string): string {
  const daemonCheckout = shellQuote(DAEMON_REPO_DIR);
  return [
    "set -eu",
    `dev=${shellQuote(devUser)}`,
    `root=${shellQuote(TURBOPANEL_ROOT)}`,
    `platform=${shellQuote(TURBOPANEL_PLATFORM)}`,
    `runtimes=${shellQuote(RUNTIMES_DIR)}`,
    `daemonCheckout=${daemonCheckout}`,
    'if getent group turbopanel >/dev/null 2>&1; then',
    '  if ! getent group turbopanel | grep -Eq ":$dev$|:.*[,:]$dev(,|$)"; then',
    '    usermod -aG turbopanel "$dev"',
    "  fi",
    "fi",
    'if command -v setfacl >/dev/null 2>&1; then',
    '  setfacl -m u:$dev:rx "$root"',
    '  setfacl -d -m u:$dev:rx "$root"',
    '  setfacl -m u:$dev:rwx "$platform"',
    '  setfacl -d -m u:$dev:rwx "$platform"',
    '  if [ -d "$runtimes" ]; then',
    '    setfacl -m u:$dev:rx "$runtimes"',
    '    setfacl -d -m u:$dev:rx "$runtimes"',
    "  fi",
    `  devOrch=${shellQuote(DEV_ORCHESTRATION_STAGED_DIR)}`,
    '  if [ -d "$devOrch" ]; then',
    '    setfacl -m u:$dev:rx "$devOrch"',
    '    setfacl -d -m u:$dev:rx "$devOrch"',
    "  fi",
    '  if [ -d "$daemonCheckout" ]; then',
    '    setfacl -R -m u:$dev:rwx "$daemonCheckout" 2>/dev/null || true',
    '    find "$daemonCheckout" -type d -exec setfacl -d -m u:$dev:rwx {} + 2>/dev/null || true',
    "  fi",
    '  for dir in daemon instance ui website; do',
    '    gitdir="$platform/$dir/.git"',
    '    [ -d "$gitdir" ] || continue',
    '    setfacl -R -m u:$dev:rwx "$gitdir"',
    '    setfacl -R -d -m u:$dev:rwx "$gitdir"',
    "  done",
    "else",
    "  # Without setfacl, allow traverse without an active turbopanel group session.",
    '  chmod o+x "$root" 2>/dev/null || true',
    '  chmod o+rx "$platform" 2>/dev/null || true',
    "fi",
  ].join("\n");
}

/** Reclaim turbopanel-owned runtime state and apply setgid + default ACLs for co-located dev. */
export async function ensureTurbopanelStateOwnership(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  resetTurbopanelUserCache();

  if (!turbopanelUserExists()) {
    return;
  }

  await ensureAclTool(onOutput);

  const dev = tryResolveDevIdentity();
  const script = buildStateOwnershipScript(dev?.user ?? null);
  const code = await runCaptured(["sudo", "-n", "bash", "-c", script], onOutput);

  if (code !== 0) {
    throw new Error("Failed to align /opt/turbopanel ownership with turbopanel user");
  }
}

/** Apply dev-user traversal/write ACLs on /opt/turbopanel and platform checkouts. */
export async function ensureDevPlatformAccess(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const dev = tryResolveDevIdentity();
  if (!dev) {
    return;
  }

  await ensureAclTool(onOutput);
  await stageDevOrchestration(onOutput);

  const script = buildDevPlatformAccessScript(dev.user);
  const code = await runCaptured(["sudo", "-n", "bash", "-c", script], onOutput);
  if (code !== 0) {
    throw new Error("Failed to ensure dev user can access platform directories");
  }
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

/** systemd runs with Group=turbopanel only — add docker supplementary group for socket access. */
export async function ensureDaemonSystemdDockerAccess(
  onOutput?: InstallOutputHandler,
): Promise<boolean> {
  resetTurbopanelUserCache();
  if (!turbopanelUserExists()) {
    return false;
  }
  if (!dockerIsPresent()) {
    return false;
  }

  const dropInDir = "/etc/systemd/system/turbopanel-daemon.service.d";
  const dropInFile = `${dropInDir}/docker-supplementary.conf`;
  const script = [
    "set -eu",
    `dropin=${shellQuote(dropInFile)}`,
    `dir=${shellQuote(dropInDir)}`,
    "if [ -f \"$dropin\" ] && grep -q '^SupplementaryGroups=docker$' \"$dropin\"; then",
    "  echo unchanged",
    "  exit 0",
    "fi",
    "mkdir -p \"$dir\"",
    "printf '%s\\n' '[Service]' 'SupplementaryGroups=docker' > \"$dropin\"",
    "systemctl daemon-reload",
    "echo changed",
  ].join("\n");

  const result = spawnSync("sudo", ["-n", "bash", "-c", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = (result.stdout ?? "").trim();
  const changed = output === "changed";

  if (result.status !== 0) {
    onOutput?.((result.stderr ?? "").trim());
    throw new Error(
      "Failed to configure docker supplementary group for turbopanel-daemon",
    );
  }

  return changed;
}

/** Add the invoking dev user to the docker group when Docker is installed. */
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

const PLATFORM_CHECKOUTS = ["daemon", "instance", "ui", "website"] as const;

/** Re-apply group write ACLs so instance-owned services (Expo) can edit source files. */
export async function ensurePlatformCheckoutGroupAccess(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const checkoutPaths = PLATFORM_CHECKOUTS.map(
    (dir) => `${TURBOPANEL_PLATFORM}/${dir}`,
  );
  const script = [
    "set -eu",
    'if ! command -v setfacl >/dev/null 2>&1; then exit 0; fi',
    `for dir in ${checkoutPaths.map(shellQuote).join(" ")}; do`,
    '  [ -d "$dir" ] || continue',
    `  setfacl -R -m g:${TURBOPANEL_GROUP}:rwx "$dir" 2>/dev/null || true`,
    `  find "$dir" -type d -exec setfacl -d -m g:${TURBOPANEL_GROUP}:rwx {} + 2>/dev/null || true`,
    "done",
  ].join("\n");

  const code = await runCaptured(["sudo", "-n", "bash", "-c", script], onOutput);
  if (code !== 0) {
    onOutput?.("Warning: could not re-apply platform checkout group ACLs");
  }
}

/** Best-effort filesystem ACL refresh on console launch; never blocks the TUI. */
export function refreshDevPermissionsQuietly(): void {
  // Dev-only: skip entirely on production hosts (no acl install, no ACL scripts).
  if (!isDevEnvironment()) {
    return;
  }

  void (async () => {
    try {
      await ensureDevPlatformAccess();
      await ensureTurbopanelStateOwnership(undefined);
      await ensurePlatformCheckoutGroupAccess();
    } catch {
      // Best-effort refresh; never block the TUI.
    }
  })();
}

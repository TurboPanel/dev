import { spawnSync } from "node:child_process";
import {
  RUNTIMES_DIR,
  TURBOPANEL_PLATFORM,
  TURBOPANEL_ROOT,
} from "./paths.ts";
import { tryResolveDevIdentity } from "./dev-identity.ts";
import { type InstallOutputHandler, runCaptured } from "./install-output.ts";

const TURBOPANEL_USER = "turbopanel";
const TURBOPANEL_GROUP = "turbopanel";

const STATE_DIRS = [".cache", ".ansible", ".local"] as const;

let turbopanelUserExistsCache: boolean | null = null;

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
  return [
    "set -eu",
    `dev=${shellQuote(devUser)}`,
    `root=${shellQuote(TURBOPANEL_ROOT)}`,
    `platform=${shellQuote(TURBOPANEL_PLATFORM)}`,
    `runtimes=${shellQuote(RUNTIMES_DIR)}`,
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
    '  for dir in daemon instance ui website; do',
    '    gitdir="$platform/$dir/.git"',
    '    [ -d "$gitdir" ] || continue',
    '    setfacl -R -m u:$dev:rwx "$gitdir"',
    '    setfacl -R -d -m u:$dev:rwx "$gitdir"',
    "  done",
    "else",
    '  chmod g+rx "$platform" 2>/dev/null || true',
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

  const dev = tryResolveDevIdentity();
  const script = buildStateOwnershipScript(dev?.user ?? null);
  const code = await runCaptured(["sudo", "-n", "bash", "-c", script], onOutput);

  if (code !== 0) {
    throw new Error("Failed to align /opt/turbopanel ownership with turbopanel user");
  }

  if (!spawnSync("sh", ["-c", "command -v setfacl >/dev/null 2>&1"], {
    stdio: "ignore",
  }).status) {
    onOutput?.(
      "Install the acl package (apt install acl) to enable co-located dev ACLs",
    );
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

/** Best-effort dev ACL refresh on console launch; never blocks the TUI. */
export function refreshDevPermissionsQuietly(): void {
  void (async () => {
    try {
      await ensureDevPlatformAccess();
      await ensureTurbopanelStateOwnership(undefined);
      await ensureDaemonSystemdDockerAccess();
    } catch {
      // Best-effort refresh; never block the TUI.
    }
  })();
}

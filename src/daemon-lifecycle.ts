import {
  DAEMON_ENV_PATH,
  DENO_BIN,
  getDevGid,
  getDevUid,
  getDevUser,
  TURBOPANEL_PLATFORM,
} from "@turbopanel/paths";
import { runInherit } from "@turbopanel/platform-install";

const CADDY_PORT = 8443;

export type BuildMode = {
  uiMode: "dev" | "static";
  instanceRunMode: "source" | "compiled";
};

function parseEnvFile(path: string): Map<string, string> {
  const values = new Map<string, string>();
  let content = "";
  try {
    content = Deno.readTextFileSync(path);
  } catch {
    return values;
  }

  for (const line of content.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      values.set(match[1], match[2]);
    }
  }

  return values;
}

export function readBuildMode(): BuildMode {
  const env = parseEnvFile(DAEMON_ENV_PATH);
  const uiMode = env.get("TURBOPANEL_UI_MODE") === "static" ? "static" : "dev";
  const instanceRunMode = env.get("TURBOPANEL_INSTANCE_RUN_MODE") === "compiled"
    ? "compiled"
    : "source";
  return { uiMode, instanceRunMode };
}

export function writeDaemonEnv(extra?: Record<string, string>): void {
  const entries: Record<string, string> = {
    TURBOPANEL_DEV_INSTANCE: "1",
    TURBOPANEL_TRUNK_BRANCH: "trunk",
    TURBOPANEL_DEV_USER: getDevUser(),
    TURBOPANEL_DEV_UID: String(getDevUid()),
    TURBOPANEL_DEV_GID: String(getDevGid()),
    ...extra,
  };

  let content = "";
  try {
    content = Deno.readTextFileSync(DAEMON_ENV_PATH);
  } catch {
    content = "";
  }

  const managedKeys = new Set(Object.keys(entries));
  const updated = new Set<string>();
  const lines: string[] = [];

  if (content.length > 0) {
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
      if (match && managedKeys.has(match[1])) {
        if (!updated.has(match[1])) {
          lines.push(`${match[1]}=${entries[match[1]]}`);
          updated.add(match[1]);
        }
        continue;
      }
      lines.push(line);
    }
  }

  for (const [key, value] of Object.entries(entries)) {
    if (!updated.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  Deno.writeTextFileSync(DAEMON_ENV_PATH, lines.join("\n") + "\n");
}

export function writeBuildMode(
  uiMode: "dev" | "static",
  instanceRunMode: "source" | "compiled",
): void {
  writeDaemonEnv({
    TURBOPANEL_UI_MODE: uiMode,
    TURBOPANEL_INSTANCE_RUN_MODE: instanceRunMode,
  });
}

export async function bootstrapOrchestration(): Promise<void> {
  const code = await runInherit([
    "bash",
    `${TURBOPANEL_PLATFORM}/daemon/scripts/bootstrap-orchestration.sh`,
  ]);
  if (code !== 0) {
    throw new Error("bootstrap-orchestration.sh failed");
  }
}

export async function installDaemonSystemd(): Promise<void> {
  const code = await runInherit([
    "sudo",
    `${TURBOPANEL_PLATFORM}/daemon/scripts/install-daemon-systemd.sh`,
  ]);
  if (code !== 0) {
    throw new Error("install-daemon-systemd.sh failed");
  }
}

export async function switchBuildMode(
  target: "production" | "dev",
): Promise<void> {
  const uiMode = target === "production" ? "static" : "dev";
  const instanceRunMode = target === "production" ? "compiled" : "source";

  writeBuildMode(uiMode, instanceRunMode);

  await bootstrapOrchestration();

  const code = await runInherit([
    "sudo",
    DENO_BIN,
    "run",
    "--allow-env",
    "--allow-read",
    "--allow-write",
    "--allow-run",
    `${TURBOPANEL_PLATFORM}/daemon/scripts/run-build-toggle.ts`,
    `--ui-mode=${uiMode}`,
    `--instance-run-mode=${instanceRunMode}`,
    "--force-build=true",
  ]);
  if (code !== 0) {
    throw new Error("run-build-toggle failed");
  }
}

export async function followLogs(): Promise<void> {
  await runInherit([
    "journalctl",
    "-f",
    "-u",
    "turbopanel-daemon",
    "-u",
    "turbopanel-instance",
    "-u",
    "turbopanel-caddy",
    "-u",
    "turbopanel-ui",
  ]);
}

function printStartupBanner(): void {
  console.log(`
-----------------------------------------
TurboPanel dev stack (systemd-managed):
  TurboPanel   @ https://localhost:${CADDY_PORT}  (Caddy, user: instance)
  Instance     @ unix:///run/turbopanel/instance.sock  (user: instance)
  UI (Expo)    @ http://127.0.0.1:8081  (user: instance)
  Daemon       @ (no port, user: turbopanel)

The daemon installs/updates everything via Ansible. Use the admin "Upgrade
System" button (or sync-dev) to update; nothing auto-updates.
=========================================
`);
}

export async function startDevStack(): Promise<void> {
  writeDaemonEnv();
  await bootstrapOrchestration();
  await installDaemonSystemd();
  printStartupBanner();
  await followLogs();
}

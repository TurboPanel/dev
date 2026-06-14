import {
  DAEMON_ENV_PATH,
  getDevGid,
  getDevUid,
  getDevUser,
  TURBOPANEL_PLATFORM,
} from "@turbopanel/paths";
import { runInherit } from "@turbopanel/platform-install";

const CADDY_PORT = 8443;

function envLineExists(content: string, key: string): boolean {
  return new RegExp(`^${key}=`, "m").test(content);
}

export function writeDaemonEnv(): void {
  const entries: Record<string, string> = {
    TURBOPANEL_DEV_INSTANCE: "1",
    TURBOPANEL_TRUNK_BRANCH: "trunk",
    TURBOPANEL_DEV_USER: getDevUser(),
    TURBOPANEL_DEV_UID: String(getDevUid()),
    TURBOPANEL_DEV_GID: String(getDevGid()),
  };

  let content = "";
  try {
    content = Deno.readTextFileSync(DAEMON_ENV_PATH);
  } catch {
    content = "";
  }

  const linesToAppend: string[] = [];
  for (const [key, value] of Object.entries(entries)) {
    if (!envLineExists(content, key)) {
      linesToAppend.push(`${key}=${value}`);
    }
  }

  if (content.length === 0 && linesToAppend.length > 0) {
    Deno.writeTextFileSync(DAEMON_ENV_PATH, linesToAppend.join("\n") + "\n");
    return;
  }

  if (linesToAppend.length > 0) {
    const suffix = content.endsWith("\n") || content.length === 0
      ? ""
      : "\n";
    Deno.writeTextFileSync(
      DAEMON_ENV_PATH,
      content + suffix + linesToAppend.join("\n") + "\n",
      { append: false },
    );
  }
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

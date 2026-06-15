import {
  CADDY_HTTPS,
  DAEMON_ENV_PATH,
  DevIdentityError,
  DENO_BIN,
  PLATFORM_CA_CERT_PATH,
  platformRepoPath,
  resolveDevIdentity,
  TURBOPANEL_PLATFORM,
  TURBOPANEL_ROOT,
} from "@turbopanel/paths";
import { ensureDevHostAccess } from "@turbopanel/ensure-dev-host-access";
import { runInherit } from "@turbopanel/platform-install";
import {
  fetchStackStatus,
  instanceReachable,
  instanceSocketPresent,
  stackSummary,
} from "@turbopanel/stack-status";

const CADDY_PORT = 8443;
const TURBOPANEL_USER = "turbopanel";
const DAEMON_DIR = platformRepoPath("daemon");
const DEV_STACK_INSTALL_SCRIPT = "scripts/run-dev-stack-install.sh";
const ENSURE_ORCHESTRATION_RUNTIME_SCRIPT =
  "scripts/ensure-orchestration-runtime.sh";
const STACK_WAIT_MS = 120_000;
const STACK_POLL_MS = 3_000;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function daemonScriptCommand(script: string): string {
  return `cd ${shellQuote(DAEMON_DIR)} && exec bash ${shellQuote(script)}`;
}

function turbopanelUserExists(): boolean {
  return new Deno.Command("getent", {
    args: ["passwd", TURBOPANEL_USER],
    stdout: "null",
    stderr: "null",
  }).outputSync().success;
}

function pathDirectlyAccessible(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

export async function runSudo(args: string[]): Promise<number> {
  const quiet = await runInherit(["sudo", "-n", ...args]);
  if (quiet === 0) {
    return 0;
  }
  return runInherit(["sudo", ...args]);
}

export async function runPrivilegedDaemonBash(script: string): Promise<number> {
  const command = daemonScriptCommand(script);

  // Always run as turbopanel when the user exists so orchestration/runtime
  // cache (uv, ansible-tmp) stays owned by turbopanel — not the dev user.
  if (turbopanelUserExists()) {
    return runSudo([
      "-u",
      TURBOPANEL_USER,
      "env",
      `HOME=${TURBOPANEL_ROOT}`,
      "bash",
      "-c",
      command,
    ]);
  }
  if (pathDirectlyAccessible(script)) {
    return runInherit(["bash", "-c", command]);
  }
  return runSudo(["bash", "-c", command]);
}

async function runRootDaemonBash(script: string): Promise<number> {
  return runSudo(["bash", "-c", daemonScriptCommand(script)]);
}

async function runPrivilegedDaemonDeno(
  script: string,
  denoArgs: string[],
  scriptArgs: string[] = [],
): Promise<number> {
  const denoInvocation = [
    DENO_BIN,
    "run",
    ...denoArgs,
    script,
    ...scriptArgs,
  ].map(shellQuote).join(" ");
  const command = `cd ${shellQuote(DAEMON_DIR)} && exec ${denoInvocation}`;

  if (pathDirectlyAccessible(script)) {
    return runInherit(["bash", "-c", command]);
  }
  if (turbopanelUserExists()) {
    return runSudo([
      "-u",
      TURBOPANEL_USER,
      "env",
      `HOME=${TURBOPANEL_ROOT}`,
      "bash",
      "-c",
      command,
    ]);
  }
  return runSudo(["bash", "-c", command]);
}

export type BuildMode = {
  uiMode: "dev" | "static";
  instanceRunMode: "source" | "compiled";
};

function readEnvFile(path: string): Map<string, string> {
  const values = new Map<string, string>();
  let content = "";
  try {
    content = Deno.readTextFileSync(path);
  } catch {
    const proc = new Deno.Command("sudo", {
      args: ["cat", path],
      stdout: "piped",
      stderr: "null",
    }).outputSync();
    if (!proc.success) {
      return values;
    }
    content = new TextDecoder().decode(proc.stdout);
  }

  for (const line of content.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      values.set(match[1], match[2]);
    }
  }

  return values;
}

function writeEnvFile(path: string, content: string): void {
  try {
    Deno.writeTextFileSync(path, content);
    return;
  } catch {
    // Fall through to sudo when the checkout is turbopanel-owned.
  }

  const tmp = Deno.makeTempFileSync({ prefix: "turbopanel-env-" });
  try {
    Deno.writeTextFileSync(tmp, content);
    const proc = new Deno.Command("sudo", {
      args: ["cp", tmp, path],
      stdout: "null",
      stderr: "inherit",
    }).outputSync();
    if (!proc.success) {
      throw new Error(`Failed to write ${path}`);
    }
  } finally {
    Deno.removeSync(tmp);
  }
}

function parseEnvFile(path: string): Map<string, string> {
  return readEnvFile(path);
}

export function readBuildMode(): BuildMode {
  const env = parseEnvFile(DAEMON_ENV_PATH);
  const uiMode = env.get("TURBOPANEL_UI_MODE") === "static" ? "static" : "dev";
  const instanceRunMode = env.get("TURBOPANEL_INSTANCE_RUN_MODE") === "compiled"
    ? "compiled"
    : "source";
  return { uiMode, instanceRunMode };
}

export function readInstanceRuntime(): "deno" | "workers" {
  const env = parseEnvFile(DAEMON_ENV_PATH);
  return env.get("TURBOPANEL_INSTANCE_RUNTIME") === "workers" ? "workers" : "deno";
}

const WORKERS_INSTANCE_URL_KEYS = [
  "TURBOPANEL_INSTANCE_URL",
  "TURBOPANEL_INSTANCE_CA",
] as const;

function resolveRuntimeForWrite(
  extra?: Record<string, string>,
): "deno" | "workers" {
  if (extra?.TURBOPANEL_INSTANCE_RUNTIME === "workers") {
    return "workers";
  }
  if (extra?.TURBOPANEL_INSTANCE_RUNTIME === "deno") {
    return "deno";
  }
  return readInstanceRuntime();
}

function requireDevIdentity() {
  try {
    return resolveDevIdentity();
  } catch (err) {
    if (err instanceof DevIdentityError) {
      throw new Error(`Developer identity: ${err.message}`);
    }
    throw err;
  }
}

export function writeDaemonEnv(extra?: Record<string, string>): void {
  const dev = requireDevIdentity();
  const runtime = resolveRuntimeForWrite(extra);
  const entries: Record<string, string> = {
    TURBOPANEL_DEV_INSTANCE: "1",
    TURBOPANEL_TRUNK_BRANCH: "trunk",
    TURBOPANEL_DEV_USER: dev.user,
    TURBOPANEL_DEV_UID: String(dev.uid),
    TURBOPANEL_DEV_GID: String(dev.gid),
    ...extra,
  };

  const removeKeys = new Set<string>();
  if (runtime === "workers") {
    entries.TURBOPANEL_INSTANCE_URL = CADDY_HTTPS;
    entries.TURBOPANEL_INSTANCE_CA = PLATFORM_CA_CERT_PATH;
  } else {
    for (const key of WORKERS_INSTANCE_URL_KEYS) {
      removeKeys.add(key);
    }
  }

  let content = "";
  try {
    content = Deno.readTextFileSync(DAEMON_ENV_PATH);
  } catch {
    content = "";
  }

  if (!content) {
    const proc = new Deno.Command("sudo", {
      args: ["cat", DAEMON_ENV_PATH],
      stdout: "piped",
      stderr: "null",
    }).outputSync();
    if (proc.success) {
      content = new TextDecoder().decode(proc.stdout);
    }
  }

  const managedKeys = new Set(Object.keys(entries));
  const updated = new Set<string>();
  const lines: string[] = [];

  if (content.length > 0) {
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
      if (match && removeKeys.has(match[1])) {
        continue;
      }
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

  writeEnvFile(DAEMON_ENV_PATH, lines.join("\n") + "\n");
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

export async function ensureOrchestrationRuntime(): Promise<void> {
  const script = `${Deno.cwd()}/${ENSURE_ORCHESTRATION_RUNTIME_SCRIPT}`;
  const code = await runInherit(["sh", script]);
  if (code !== 0) {
    throw new Error("ensure-orchestration-runtime.sh failed");
  }
}

export async function bootstrapOrchestration(): Promise<void> {
  const script =
    `${TURBOPANEL_PLATFORM}/daemon/scripts/bootstrap-orchestration.sh`;
  const code = await runPrivilegedDaemonBash(script);
  if (code !== 0) {
    throw new Error("bootstrap-orchestration.sh failed");
  }
}

export async function runDevStackInstall(): Promise<void> {
  const script = `${Deno.cwd()}/${DEV_STACK_INSTALL_SCRIPT}`;
  const code = await runInherit(["sh", script]);
  if (code !== 0) {
    throw new Error("instance dev stack install failed");
  }
}

export async function installDaemonSystemd(): Promise<void> {
  const script =
    `${TURBOPANEL_PLATFORM}/daemon/scripts/install-daemon-systemd.sh`;
  const code = await runRootDaemonBash(script);
  if (code !== 0) {
    throw new Error("install-daemon-systemd.sh failed");
  }
}

async function restartDevStackServices(): Promise<void> {
  const runtime = readInstanceRuntime();
  await runSudo(["systemctl", "daemon-reload"]);
  const required = runtime === "workers"
    ? (["turbopanel-instance", "turbopanel-caddy", "turbopanel-daemon"] as const)
    : ([
      "turbopanel-instance",
      "turbopanel-caddy",
      "turbopanel-daemon",
    ] as const);
  for (const unit of required) {
    const code = await runSudo(["systemctl", "restart", unit]);
    if (code !== 0) {
      throw new Error(`failed to restart ${unit}`);
    }
  }
  // UI unit is dev-only; ignore restart failure in static mode.
  await runSudo(["systemctl", "restart", "turbopanel-ui"]);
}

function stackIsReady(): boolean {
  const runtime = readInstanceRuntime();
  const units = fetchStackStatus();
  const caddy = units.find((unit) => unit.unit === "turbopanel-caddy");
  if (runtime === "workers") {
    return caddy?.active === true && instanceReachable();
  }
  const instance = units.find((unit) => unit.unit === "turbopanel-instance");
  return instance?.active === true &&
    caddy?.active === true &&
    instanceSocketPresent();
}

async function waitForDevStack(): Promise<void> {
  const runtime = readInstanceRuntime();
  const deadline = Date.now() + STACK_WAIT_MS;
  if (runtime === "workers") {
    console.log("→ Workers runtime: waiting for instance (wrangler) and Caddy...");
  } else {
    console.log("→ Waiting for instance and Caddy to become ready...");
  }
  while (Date.now() < deadline) {
    if (stackIsReady()) {
      if (runtime === "workers") {
        console.log("✓ Workers instance and Caddy are ready");
      } else {
        console.log("✓ Dev stack is ready");
      }
      return;
    }
    const units = fetchStackStatus();
    const instance = units.find((unit) => unit.unit === "turbopanel-instance");
    const caddy = units.find((unit) => unit.unit === "turbopanel-caddy");
    if (runtime === "workers") {
      console.log(`  … caddy: ${caddy?.detail ?? "?"}`);
    } else {
      console.log(
        `  … instance: ${instance?.detail ?? "?"}, caddy: ${caddy?.detail ?? "?"}, socket: ${
          instanceSocketPresent() ? "ready" : "waiting"
        }`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, STACK_POLL_MS));
  }
  console.log(
    "⚠ Stack services still starting — check status below or follow logs",
  );
}

export async function switchBuildMode(
  target: "production" | "dev",
): Promise<void> {
  const uiMode = target === "production" ? "static" : "dev";
  const instanceRunMode = target === "production" ? "compiled" : "source";

  writeBuildMode(uiMode, instanceRunMode);

  await ensureOrchestrationRuntime();
  await bootstrapOrchestration();

  const toggleScript =
    `${TURBOPANEL_PLATFORM}/daemon/scripts/run-build-toggle.ts`;
  const code = await runPrivilegedDaemonDeno(
    toggleScript,
    [
      "--allow-env",
      "--allow-read",
      "--allow-write",
      "--allow-run",
    ],
    [
      `--ui-mode=${uiMode}`,
      `--instance-run-mode=${instanceRunMode}`,
      "--force-build=true",
    ],
  );
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
  const runtime = readInstanceRuntime();
  if (runtime === "workers") {
    console.log(`
-----------------------------------------
TurboPanel dev stack (Workers runtime):
  Caddy        @ https://localhost:${CADDY_PORT}  (user: instance)
  Instance     @ wrangler dev via turbopanel-instance.service (systemd)
  UI (Expo)    @ http://127.0.0.1:8081  (user: instance)
  Daemon       @ (no port, user: turbopanel)
  Postgres     @ 127.0.0.1:5432 (TCP, for wrangler Hyperdrive)

The daemon installs/updates everything via Ansible. Use the admin "Upgrade
System" button (or sync-dev) to update; nothing auto-updates.
=========================================
`);
    return;
  }

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

function printStackStatus(): void {
  const runtime = readInstanceRuntime();
  const units = fetchStackStatus();
  console.log("Dev stack status:", stackSummary(units));
  for (const unit of units) {
    const mark = unit.active === true
      ? "✓"
      : unit.active === false
      ? "○"
      : "?";
    console.log(`  ${mark} ${unit.label}: ${unit.detail}`);
  }
  if (runtime === "workers") {
    console.log(
      instanceReachable()
        ? "  ✓ instance API reachable via Caddy/wrangler"
        : "  ○ instance API not reachable — check journalctl -u turbopanel-instance",
    );
  } else {
    console.log(
      instanceSocketPresent()
        ? "  ✓ instance.sock ready"
        : "  ○ instance.sock not ready",
    );
  }
  console.log("");
  console.log(
    "Follow logs: journalctl -fu turbopanel-daemon -u turbopanel-instance -u turbopanel-caddy -u turbopanel-ui",
  );
}

export async function startDevStack(): Promise<void> {
  await ensureDevHostAccess();
  writeDaemonEnv();
  await ensureOrchestrationRuntime();
  await bootstrapOrchestration();
  await runDevStackInstall();
  await installDaemonSystemd();
  await restartDevStackServices();
  await waitForDevStack();
  printStartupBanner();
  printStackStatus();
}

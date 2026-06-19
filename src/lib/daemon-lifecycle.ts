import {
  ANSIBLE_PLAYBOOK_BIN,
  CADDY_HTTPS,
  DAEMON_ENV_PATH,
  DevIdentityError,
  DENO_BIN,
  DAEMON_DENO_CONFIG,
  PLATFORM_CA_CERT_PATH,
  platformRepoPath,
  resolveDevIdentity,
  TURBOPANEL_PLATFORM,
  TURBOPANEL_ROOT,
} from "@turbopanel/lib/paths.ts";
import { daemonEnvAssignments } from "@turbopanel/lib/daemon-env.ts";
import { ensureWebsiteSystemdUnit } from "@turbopanel/lib/ensure-website-systemd.ts";
import { ensureUiServiceRuntimeDirs } from "@turbopanel/lib/ensure-ui-service.ts";
import {
  ansiblePlaybookEnv,
  ensureOrchestrationRunnerInstalled,
  runBuildTogglePrivileged,
  runInstanceDevInstallPrivileged,
} from "@turbopanel/lib/daemon-orchestration.ts";
import { ensureTurbopanelGithubAccess } from "@turbopanel/lib/turbopanel-github-access.ts";
import { runInherit } from "@turbopanel/lib/platform-install.ts";
import {
  fetchStackStatus,
  instanceReachable,
  instanceSocketPresent,
} from "@turbopanel/lib/stack-status.ts";

const TURBOPANEL_USER = "turbopanel";
const TURBOPANEL_GROUP = "turbopanel";
const DAEMON_DIR = platformRepoPath("daemon");
const INSTANCE_REPO_TASKS =
  `${DAEMON_DIR}/orchestration/roles/instance-repo/tasks/main.yml`;
const UI_REPO_TASKS =
  `${DAEMON_DIR}/orchestration/roles/ui-repo/tasks/main.yml`;
const WEBSITE_REPO_TASKS =
  `${DAEMON_DIR}/orchestration/roles/website-repo/tasks/main.yml`;
const TURBOPANEL_USER_SETUP_PLAYBOOK = new URL(
  "../../scripts/patches/turbopanel-user-setup.yml",
  import.meta.url,
).pathname;
const INSTANCE_REPO_PATCH = new URL(
  "../../scripts/patches/instance-repo-tasks-main.yml",
  import.meta.url,
).pathname;
const UI_REPO_PATCH = new URL(
  "../../scripts/patches/ui-repo-tasks-main.yml",
  import.meta.url,
).pathname;
const WEBSITE_REPO_PATCH = new URL(
  "../../scripts/patches/website-repo-tasks-main.yml",
  import.meta.url,
).pathname;
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

function sudoCredentialsValid(): boolean {
  return new Deno.Command("sudo", {
    args: ["-n", "true"],
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).outputSync().success;
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

  // Always run as turbopanel when the user exists so runtimes/uv cache
  // (uv, ansible-tmp) stays owned by turbopanel — not the dev user.
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

async function runRootDaemonBash(script: string): Promise<number> {
  return runSudo(["bash", "-c", daemonScriptCommand(script)]);
}

async function runPrivilegedDaemonDenoCapture(
  script: string,
  denoArgs: string[],
  scriptArgs: string[] = [],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const denoInvocation = [
    DENO_BIN,
    "run",
    ...denoArgs,
    script,
    ...scriptArgs,
  ].map(shellQuote).join(" ");
  // turbopanel must not inherit the developer's cwd (e.g. ~/turbopanel-dev).
  const command = `cd ${shellQuote(DAEMON_DIR)} && exec ${denoInvocation}`;

  const tpExists = turbopanelUserExists();
  // UV_VENV_CLEAR lets `uv venv` overwrite a partial venv left by an interrupted
  // bootstrap instead of failing with "a virtual environment already exists".
  const envAssignments = [
    `HOME=${TURBOPANEL_ROOT}`,
    "UV_VENV_CLEAR=1",
    ...daemonEnvAssignments(),
  ];
  const sudoBody = tpExists
    ? [
      "-u",
      TURBOPANEL_USER,
      "env",
      ...envAssignments,
      "bash",
      "-c",
      command,
    ]
    : [
      "env",
      ...envAssignments,
      "bash",
      "-c",
      command,
    ];

  async function attempt(nopass: boolean): Promise<Deno.CommandOutput> {
    const prefix = nopass ? ["-n"] : [];
    return await new Deno.Command("sudo", {
      args: [...prefix, ...sudoBody],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
  }

  let output = await attempt(true);
  if (!output.success && (output.code ?? 1) === 1) {
    output = await attempt(false);
  }

  return {
    code: output.code ?? 1,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
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

  const tpExists = turbopanelUserExists();

  // Always run as turbopanel when the user exists so runtimes/uv cache
  // (uv, python, ansible) stays owned by turbopanel — not the dev user.
  if (tpExists) {
    return runSudo([
      "-u",
      TURBOPANEL_USER,
      "env",
      `HOME=${TURBOPANEL_ROOT}`,
      ...daemonEnvAssignments(),
      "bash",
      "-c",
      command,
    ]);
  }
  // Before Ansible creates turbopanel, bootstrap must install runtimes as root.
  return runSudo([
    "env",
    `HOME=${TURBOPANEL_ROOT}`,
    ...daemonEnvAssignments(),
    "bash",
    "-c",
    command,
  ]);
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

async function ensureTurbopanelUser(): Promise<void> {
  if (turbopanelUserExists()) {
    return;
  }

  const envAssignments = Object.entries(ansiblePlaybookEnv()).map(
    ([key, value]) => `${key}=${value}`,
  );
  const code = await runSudo([
    "env",
    ...envAssignments,
    ANSIBLE_PLAYBOOK_BIN,
    "-i",
    "localhost,",
    "-c",
    "local",
    TURBOPANEL_USER_SETUP_PLAYBOOK,
  ]);
  if (code !== 0 || !turbopanelUserExists()) {
    throw new Error("Failed to create turbopanel system user");
  }
}

async function ensureDaemonCheckoutOwnership(): Promise<void> {
  if (!turbopanelUserExists()) {
    return;
  }

  const code = await runSudo([
    "chown",
    "-R",
    `${TURBOPANEL_USER}:${TURBOPANEL_GROUP}`,
    platformRepoPath("daemon"),
  ]);
  if (code !== 0) {
    throw new Error("Failed to align daemon checkout ownership with turbopanel user");
  }
}

async function alignDevStackOwnership(): Promise<void> {
  await ensureTurbopanelRuntimesOwnership();
  await ensureDaemonCheckoutOwnership();
}

async function prepareCheckoutPlaceholdersForClone(): Promise<void> {
  const script = [
    `set -eu`,
    `stamp='.turbopanel-checkout-stamp'`,
    `for dir in instance ui website; do`,
    `  path="/opt/turbopanel/platform/$dir"`,
    `  [ -e "$path/.git" ] && continue`,
    `  [ ! -d "$path" ] && continue`,
    `  real_count=$(find "$path" -mindepth 1 -maxdepth 1 ! -name "$stamp" -print 2>/dev/null | wc -l | tr -d ' ')`,
    `  [ "$real_count" = 0 ] && rm -rf "$path"`,
    `done`,
  ].join("\n");
  const code = await runSudo(["bash", "-c", script]);
  if (code !== 0) {
    throw new Error("Failed to clear checkout placeholders before Ansible converge");
  }
}

async function applyAnsibleRolePatch(
  patchPath: string,
  targetPath: string,
  label: string,
): Promise<void> {
  let patch = "";
  try {
    patch = Deno.readTextFileSync(patchPath);
  } catch {
    throw new Error(`Missing ${label} Ansible patch in turbopanel-dev checkout`);
  }

  const tmp = Deno.makeTempFileSync({ prefix: `${label}-patch-` });
  try {
    Deno.writeTextFileSync(tmp, patch);
    const code = await runSudo(["cp", tmp, targetPath]);
    if (code !== 0) {
      throw new Error(`Failed to patch ${label} Ansible role`);
    }
    await runSudo([
      "chown",
      `${TURBOPANEL_USER}:${TURBOPANEL_GROUP}`,
      targetPath,
    ]);
  } finally {
    Deno.removeSync(tmp);
  }
}

async function ensurePlatformRepoCloneFixes(): Promise<void> {
  await applyAnsibleRolePatch(
    INSTANCE_REPO_PATCH,
    INSTANCE_REPO_TASKS,
    "instance-repo",
  );
  await applyAnsibleRolePatch(UI_REPO_PATCH, UI_REPO_TASKS, "ui-repo");
  await applyAnsibleRolePatch(
    WEBSITE_REPO_PATCH,
    WEBSITE_REPO_TASKS,
    "website-repo",
  );
}

async function ensureTurbopanelRuntimesOwnership(): Promise<void> {
  if (!turbopanelUserExists()) {
    return;
  }

  const runtimesDir = `${TURBOPANEL_ROOT}/runtimes`;
  // Early bootstrap as root can leave root-owned files under uv/cache while the
  // top-level runtimes directory is already turbopanel-owned and writable.
  const code = await runSudo([
    "chown",
    "-R",
    `${TURBOPANEL_USER}:${TURBOPANEL_GROUP}`,
    runtimesDir,
  ]);
  // turbopanel's HOME (/opt/turbopanel) must be writable so ansible can create
  // ~/.ansible/tmp during bootstrap verification. The turbopanel-user Ansible
  // role normally owns this dir, but it has not run yet at bootstrap time.
  // Non-recursive: keep platform/ subtree ownership untouched; mode stays 0755
  // so the dev user can still traverse into runtimes/.
  const rootCode = await runSudo([
    "chown",
    `${TURBOPANEL_USER}:${TURBOPANEL_GROUP}`,
    TURBOPANEL_ROOT,
  ]);
  // An early bootstrap run as root creates a root-owned ~/.ansible under
  // /opt/turbopanel; reclaim it so the turbopanel user can write its tmp dir.
  const ansibleHomeCode = await runSudo([
    "bash",
    "-c",
    `d=${shellQuote(`${TURBOPANEL_ROOT}/.ansible`)}; if [ -e "$d" ]; then chown -R ${TURBOPANEL_USER}:${TURBOPANEL_GROUP} "$d"; fi`,
  ]);
  // Early Deno/corepack installs as root can leave a root-owned ~/.cache; pnpm
  // via corepack needs turbopanel to write under /opt/turbopanel/.cache/node.
  const cacheHomeCode = await runSudo([
    "bash",
    "-c",
    `d=${shellQuote(`${TURBOPANEL_ROOT}/.cache`)}; if [ -e "$d" ]; then chown -R ${TURBOPANEL_USER}:${TURBOPANEL_GROUP} "$d"; fi`,
  ]);
  if (code !== 0 || rootCode !== 0 || ansibleHomeCode !== 0 || cacheHomeCode !== 0) {
    throw new Error("Failed to align /opt/turbopanel ownership with turbopanel user");
  }
}

export async function bootstrapOrchestration(): Promise<void> {
  await ensureTurbopanelRuntimesOwnership();
  const script =
    `${TURBOPANEL_PLATFORM}/daemon/scripts/bootstrap-orchestration.ts`;
  const denoArgs = [
    "--config",
    DAEMON_DENO_CONFIG,
    "--allow-net",
    "--allow-read",
    "--allow-write",
    "--allow-run",
    "--allow-env",
  ];

  const result = await runPrivilegedDaemonDenoCapture(script, denoArgs);
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    if (/sudo:.*(password|terminal)/i.test(detail)) {
      throw new Error(
        "sudo credentials expired — quit the console and run ./console again to re-authenticate",
      );
    }
    throw new Error(
      detail
        ? `bootstrap-orchestration.ts failed: ${detail.split("\n").at(-1)}`
        : "bootstrap-orchestration.ts failed",
    );
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

export async function buildDaemonBinary(): Promise<void> {
  const script =
    `${TURBOPANEL_PLATFORM}/daemon/scripts/run-daemon-update.sh`;
  const code = await runPrivilegedDaemonBash(script);
  if (code !== 0) {
    throw new Error("run-daemon-update.sh failed");
  }
}

function resolveLanIp(): string {
  for (const addr of Deno.networkInterfaces()) {
    if (addr.family !== "IPv4") continue;
    const ip = addr.address;
    if (ip.startsWith("127.") || ip.startsWith("169.254.")) continue;
    return ip;
  }
  return "127.0.0.1";
}

export async function startUpdateServer(): Promise<
  { pid: number; url: string }
> {
  const serveScriptPath =
    `${TURBOPANEL_PLATFORM}/daemon/scripts/serve-update.sh`;
  const child = new Deno.Command("sh", {
    args: [serveScriptPath],
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const lanIp = resolveLanIp();
  return { pid: child.pid, url: `http://${lanIp}:8444` };
}

async function restartDevStackServices(): Promise<void> {
  const runtime = readInstanceRuntime();
  await runSudo(["systemctl", "daemon-reload"]);
  if (runtime === "workers") {
    for (const unit of [
      "turbopanel-instance",
      "turbopanel-caddy",
      "turbopanel-daemon",
      "turbopanel-website",
    ] as const) {
      const code = await runSudo(["systemctl", "restart", unit]);
      if (code !== 0) {
        throw new Error(`failed to restart ${unit}`);
      }
    }
    await runSudo(["systemctl", "restart", "turbopanel-ui"]);
    return;
  }
  // Deno mode: instance-dev-install already converged instance/caddy units.
  const code = await runSudo(["systemctl", "restart", "turbopanel-daemon"]);
  if (code !== 0) {
    throw new Error("failed to restart turbopanel-daemon");
  }
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

async function waitForDevStack(
  onStep?: TaskStepHandler,
): Promise<void> {
  onStep?.("Waiting for stack to become ready", "running");
  const deadline = Date.now() + STACK_WAIT_MS;
  while (Date.now() < deadline) {
    if (stackIsReady()) {
      onStep?.("Waiting for stack to become ready", "ok");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, STACK_POLL_MS));
  }
  onStep?.("Waiting for stack to become ready", "failed");
  throw new Error(
    `Dev stack did not become ready within ${STACK_WAIT_MS / 1000} seconds`,
  );
}

export async function switchBuildMode(
  target: "production" | "dev",
  onEvent?: (event: unknown) => void,
): Promise<void> {
  const uiMode = target === "production" ? "static" : "dev";
  const instanceRunMode = target === "production" ? "compiled" : "source";

  writeBuildMode(uiMode, instanceRunMode);
  await bootstrapOrchestration();

  await runBuildTogglePrivileged(
    { uiMode, instanceRunMode, forceBuild: true },
    onEvent,
  );
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
    "-u",
    "turbopanel-website",
  ]);
}

export type TaskStepHandler = (
  label: string,
  status: "running" | "ok" | "failed",
  id?: string,
) => void;

export async function startDevStack(handlers?: {
  onEvent?: (event: unknown) => void;
  onStep?: TaskStepHandler;
}): Promise<void> {
  const { onEvent, onStep } = handlers ?? {};

  writeDaemonEnv();

  onStep?.("Verify sudo access", "running");
  if (!sudoCredentialsValid()) {
    onStep?.("Verify sudo access", "failed");
    throw new Error(
      "sudo credentials expired — quit the console and run ./console again to re-authenticate",
    );
  }
  onStep?.("Verify sudo access", "ok");

  onStep?.("Bootstrap orchestration", "running");
  await bootstrapOrchestration();
  onStep?.("Bootstrap orchestration", "ok");

  onStep?.("Ensure turbopanel service user", "running");
  await ensureTurbopanelUser();
  onStep?.("Ensure turbopanel service user", "ok");

  onStep?.("Align platform ownership", "running");
  await alignDevStackOwnership();
  onStep?.("Align platform ownership", "ok");

  onStep?.("Configure turbopanel GitHub SSH", "running");
  await ensureTurbopanelGithubAccess();
  onStep?.("Configure turbopanel GitHub SSH", "ok");

  onStep?.("Install orchestration runner", "running");
  await ensureOrchestrationRunnerInstalled();
  onStep?.("Install orchestration runner", "ok");

  onStep?.("Patch platform-repo clone logic", "running");
  await ensurePlatformRepoCloneFixes();
  onStep?.("Patch platform-repo clone logic", "ok");

  onStep?.("Clear checkout placeholders", "running");
  await prepareCheckoutPlaceholdersForClone();
  onStep?.("Clear checkout placeholders", "ok");

  onStep?.("Converge dev stack (Ansible)", "running");
  try {
    await runInstanceDevInstallPrivileged(onEvent);
    onStep?.("Converge dev stack (Ansible)", "ok");
  } catch (err) {
    onStep?.("Converge dev stack (Ansible)", "failed");
    throw err;
  }

  if (readInstanceRuntime() === "workers") {
    onStep?.("Install website systemd unit", "running");
    await ensureWebsiteSystemdUnit();
    onStep?.("Install website systemd unit", "ok");
  }

  onStep?.("Install daemon systemd unit", "running");
  await installDaemonSystemd();
  onStep?.("Install daemon systemd unit", "ok");

  onStep?.("Restart dev stack services", "running");
  await restartDevStackServices();
  onStep?.("Restart dev stack services", "ok");

  if (readInstanceRuntime() === "deno" && readBuildMode().uiMode === "dev") {
    onStep?.("Prepare UI service", "running");
    await ensureUiServiceRuntimeDirs();
    const uiRestart = await runSudo(["systemctl", "restart", "turbopanel-ui"]);
    if (uiRestart !== 0) {
      onStep?.("Prepare UI service", "failed");
      throw new Error("failed to restart turbopanel-ui after preparing runtime dirs");
    }
    onStep?.("Prepare UI service", "ok");
  }

  await waitForDevStack(onStep);
}

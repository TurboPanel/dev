import {
  ANSIBLE_COLLECTIONS_PATH,
  ANSIBLE_LOCAL_TMP,
  DAEMON_DENO_CONFIG,
  DENO_BIN,
  TURBOPANEL_PLATFORM,
  TURBOPANEL_ROOT,
} from "@turbopanel/lib/paths.ts";
import { daemonEnvAssignments } from "@turbopanel/lib/daemon-env.ts";
import { runInherit } from "@turbopanel/lib/platform-install.ts";

const CONSOLE_RUNNER_SCRIPT = new URL(
  "../../scripts/run-orchestration-action.ts",
  import.meta.url,
).pathname;
const ORCHESTRATION_RUNNER_SCRIPT =
  `${TURBOPANEL_PLATFORM}/daemon/scripts/run-orchestration-action.ts`;
const TURBOPANEL_USER = "turbopanel";
const TURBOPANEL_GROUP = "turbopanel";
const DAEMON_DIR = `${TURBOPANEL_PLATFORM}/daemon`;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Install the orchestration runner where turbopanel can read and execute it. */
export async function ensureOrchestrationRunnerInstalled(): Promise<void> {
  const script = `mkdir -p ${shellQuote(`${DAEMON_DIR}/scripts`)} && cp ${shellQuote(CONSOLE_RUNNER_SCRIPT)} ${shellQuote(ORCHESTRATION_RUNNER_SCRIPT)} && chown ${TURBOPANEL_USER}:${TURBOPANEL_GROUP} ${shellQuote(ORCHESTRATION_RUNNER_SCRIPT)}`;
  const quiet = await runInherit(["sudo", "-n", "bash", "-c", script]);
  if (quiet === 0) {
    return;
  }
  const code = await runInherit(["sudo", "bash", "-c", script]);
  if (code !== 0) {
    throw new Error("Failed to install orchestration runner script");
  }
}

export type DaemonAnsibleEventsModule = {
  runPlaybookStreaming: (
    ansiblePlaybookBin: string,
    args: string[],
    options: {
      cwd?: string;
      env?: Record<string, string>;
      onEvent: (event: unknown) => void;
    },
  ) => Promise<void>;
  AnsibleEvent: unknown;
};

export type DaemonOrchestrationModule = {
  runInstanceDevInstall: (onEvent?: (event: unknown) => void) => Promise<void>;
  runBuildToggle: (
    opts: {
      uiMode: "dev" | "static";
      instanceRunMode: "source" | "compiled";
      forceBuild?: boolean;
    },
    onEvent?: (event: unknown) => void,
  ) => Promise<void>;
  runPostgresSetup: (onEvent?: (event: unknown) => void) => Promise<void>;
};

export function ansiblePlaybookEnv(): Record<string, string> {
  const orchestrationDir = `${TURBOPANEL_PLATFORM}/daemon/orchestration`;
  return {
    ANSIBLE_CONFIG: `${orchestrationDir}/ansible.cfg`,
    ANSIBLE_LOCAL_TEMP: ANSIBLE_LOCAL_TMP,
    ANSIBLE_COLLECTIONS_PATH: ANSIBLE_COLLECTIONS_PATH,
  };
}

function turbopanelUserExists(): boolean {
  return new Deno.Command("getent", {
    args: ["passwd", TURBOPANEL_USER],
    stdout: "null",
    stderr: "null",
  }).outputSync().success;
}

function parseEventLine(line: string): unknown | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

interface StreamCommandResult {
  code: number;
  success: boolean;
}

async function readStreamToString(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

async function streamCommand(
  cmd: string,
  args: string[],
  onStdoutLine: (line: string) => void,
): Promise<StreamCommandResult & { stderr: string }> {
  const child = new Deno.Command(cmd, {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const stderrPromise = child.stderr
    ? readStreamToString(child.stderr)
    : Promise.resolve("");

  const stdoutPromise = (async () => {
    const stdout = child.stdout;
    if (!stdout) return;
    const decoder = new TextDecoder();
    let buffer = "";
    const reader = stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.length > 0) onStdoutLine(line);
          newlineIndex = buffer.indexOf("\n");
        }
      }
      if (buffer.length > 0) onStdoutLine(buffer);
    } finally {
      reader.releaseLock();
    }
  })();

  const [, stderrText] = await Promise.all([stdoutPromise, stderrPromise]);
  const status = await child.status;
  return {
    code: status.code,
    success: status.success,
    stderr: stderrText,
  };
}

async function streamSudo(
  args: string[],
  onStdoutLine: (line: string) => void,
): Promise<StreamCommandResult & { stderr: string }> {
  const quiet = await streamCommand("sudo", ["-n", ...args], onStdoutLine);
  if (quiet.success || quiet.code !== 1) {
    return quiet;
  }
  return await streamCommand("sudo", args, onStdoutLine);
}

function orchestrationDenoArgs(runnerArgs: string[]): string[] {
  return [
    "run",
    "--config",
    DAEMON_DENO_CONFIG,
    "--allow-read",
    "--allow-run",
    "--allow-env",
    "--allow-write",
    ORCHESTRATION_RUNNER_SCRIPT,
    ...runnerArgs,
  ];
}

async function streamPrivilegedOrchestration(
  runnerArgs: string[],
  onEvent?: (event: unknown) => void,
): Promise<void> {
  const handleLine = (line: string) => {
    const event = parseEventLine(line);
    if (event) {
      onEvent?.(event);
    }
  };

  const denoArgs = orchestrationDenoArgs(runnerArgs);
  const denoInvocation = [DENO_BIN, ...denoArgs].map(shellQuote).join(" ");
  const command = `cd ${shellQuote(DAEMON_DIR)} && exec ${denoInvocation}`;
  const envAssignments = [
    `HOME=${TURBOPANEL_ROOT}`,
    "UV_VENV_CLEAR=1",
    ...daemonEnvAssignments(),
  ];
  let result: StreamCommandResult & { stderr: string };

  const tpExists = turbopanelUserExists();

  if (tpExists) {
    result = await streamSudo([
      "-u",
      TURBOPANEL_USER,
      "env",
      ...envAssignments,
      "bash",
      "-c",
      command,
    ], handleLine);
  } else {
    // Before Ansible creates turbopanel, orchestration must run as root.
    result = await streamSudo([
      "env",
      ...envAssignments,
      "bash",
      "-c",
      command,
    ], handleLine);
  }

  if (!result.success) {
    const detail = result.stderr.trim().split("\n").at(-1) ?? "";
    throw new Error(
      detail
        ? `orchestration action failed (exit ${result.code}): ${detail}`
        : `orchestration action failed (exit ${result.code}): ${runnerArgs.join(" ")}`,
    );
  }
}

export async function runInstanceDevInstallPrivileged(
  onEvent?: (event: unknown) => void,
): Promise<void> {
  await streamPrivilegedOrchestration(["instance-dev-install"], onEvent);
}

export async function runBuildTogglePrivileged(
  opts: {
    uiMode: "dev" | "static";
    instanceRunMode: "source" | "compiled";
    forceBuild?: boolean;
  },
  onEvent?: (event: unknown) => void,
): Promise<void> {
  await streamPrivilegedOrchestration(
    ["build-toggle", JSON.stringify(opts)],
    onEvent,
  );
}

async function runPrivilegedPlaybook(
  playbookRelative: string,
  extraArgs: string[],
  onEvent?: (event: unknown) => void,
): Promise<void> {
  await streamPrivilegedOrchestration(
    ["playbook", playbookRelative, ...extraArgs],
    onEvent,
  );
}

export async function runPostgresSetupWithExpose(
  exposePort: boolean,
  onEvent?: (event: unknown) => void,
): Promise<void> {
  await runPrivilegedPlaybook(
    "postgres-setup.yml",
    ["-e", `postgres_expose_port=${exposePort}`],
    onEvent,
  );
}

export async function runInstanceLaunchRefresh(
  runtime: "deno" | "workers",
  onEvent?: (event: unknown) => void,
): Promise<void> {
  await runPrivilegedPlaybook(
    "instance-launch-only.yml",
    [
      "-e",
      `turbopanel_instance_runtime=${runtime}`,
      "-e",
      `postgres_expose_port=${runtime === "workers"}`,
    ],
    onEvent,
  );
}

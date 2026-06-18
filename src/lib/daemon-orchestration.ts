import {
  ANSIBLE_COLLECTIONS_PATH,
  ANSIBLE_LOCAL_TMP,
  DAEMON_DENO_CONFIG,
  DENO_BIN,
  TURBOPANEL_PLATFORM,
  TURBOPANEL_ROOT,
} from "@turbopanel/lib/paths.ts";

const ORCHESTRATION_RUNNER_SCRIPT = new URL(
  "../../scripts/run-orchestration-action.ts",
  import.meta.url,
).pathname;
const TURBOPANEL_USER = "turbopanel";

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

async function readStdoutLines(
  stdout: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
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
        if (line.length > 0) onLine(line);
        newlineIndex = buffer.indexOf("\n");
      }
    }

    if (buffer.length > 0) onLine(buffer);
  } finally {
    reader.releaseLock();
  }
}

async function streamCommand(
  cmd: string,
  args: string[],
  onStdoutLine: (line: string) => void,
): Promise<StreamCommandResult> {
  const child = new Deno.Command(cmd, {
    args,
    stdin: "inherit",
    stdout: "piped",
    stderr: "inherit",
  }).spawn();

  const stdout = child.stdout;
  if (stdout) {
    await readStdoutLines(stdout, onStdoutLine);
  }

  const status = await child.status;
  return { code: status.code, success: status.success };
}

async function streamSudo(
  args: string[],
  onStdoutLine: (line: string) => void,
): Promise<StreamCommandResult> {
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
    "--allow-net",
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
  let result: StreamCommandResult;

  if (turbopanelUserExists()) {
    result = await streamSudo([
      "-u",
      TURBOPANEL_USER,
      "env",
      `HOME=${TURBOPANEL_ROOT}`,
      DENO_BIN,
      ...denoArgs,
    ], handleLine);
  } else {
    result = await streamCommand(DENO_BIN, denoArgs, handleLine);
  }

  if (!result.success) {
    throw new Error(
      `orchestration action failed (exit ${result.code}): ${runnerArgs.join(" ")}`,
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

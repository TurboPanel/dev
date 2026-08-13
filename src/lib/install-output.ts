import { spawn, type SpawnOptions } from "node:child_process";

export type InstallOutputHandler = (line: string) => void;

export function appendOutputLines(
  lines: string[],
  line: string,
  maxLines = 8,
): string[] {
  const next = [...lines, line];
  return next.length > maxLines ? next.slice(-maxLines) : next;
}

export function sanitizeInstallOutput(text: string): string {
  return text
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .trimEnd();
}

export function captureChildEnv(
  extra?: Record<string, string>,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TERM: "dumb",
    NO_COLOR: "1",
    CI: "1",
    DEBIAN_FRONTEND: "noninteractive",
    GIT_TERMINAL_PROMPT: "0",
    ...extra,
  };
}

function emitChunk(chunk: Buffer | string, onLine?: InstallOutputHandler): void {
  if (!onLine) {
    return;
  }

  const cleaned = sanitizeInstallOutput(chunk.toString());
  for (const line of cleaned.split("\n")) {
    const trimmed = line.trimEnd();
    if (trimmed.length > 0) {
      onLine(trimmed);
    }
  }
}

function withNonInteractiveSudo(cmd: string[]): string[] {
  if (cmd[0] !== "sudo" || cmd.includes("-n")) {
    return cmd;
  }
  return ["sudo", "-n", ...cmd.slice(1)];
}

export type RunCapturedOptions = Pick<SpawnOptions, "env" | "cwd"> & {
  /** When aborted, SIGTERM the child and resolve with exit code 130. */
  signal?: AbortSignal;
};

/** Conventional exit status used when {@link RunCapturedOptions.signal} aborts. */
export const RUN_CAPTURED_ABORTED_EXIT = 130;

export async function runCaptured(
  cmd: string[],
  onLine?: InstallOutputHandler,
  options: RunCapturedOptions = {},
): Promise<number> {
  if (options.signal?.aborted) {
    return RUN_CAPTURED_ABORTED_EXIT;
  }

  const argv = withNonInteractiveSudo(cmd);

  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: options.cwd,
      env: captureChildEnv(options.env as Record<string, string> | undefined),
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    const onAbort = () => {
      child.kill("SIGTERM");
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (code: number) => {
      options.signal?.removeEventListener("abort", onAbort);
      resolve(code);
    };

    child.stdout?.on("data", (chunk) => emitChunk(chunk, onLine));
    child.stderr?.on("data", (chunk) => emitChunk(chunk, onLine));
    child.on("error", () => finish(1));
    child.on("close", (code) => {
      if (options.signal?.aborted) {
        finish(RUN_CAPTURED_ABORTED_EXIT);
        return;
      }
      finish(code ?? 1);
    });
  });
}

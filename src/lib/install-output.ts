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

export async function runCaptured(
  cmd: string[],
  onLine?: InstallOutputHandler,
  options: Pick<SpawnOptions, "env" | "cwd"> = {},
): Promise<number> {
  const argv = withNonInteractiveSudo(cmd);

  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: options.cwd,
      env: captureChildEnv(options.env as Record<string, string> | undefined),
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    child.stdout?.on("data", (chunk) => emitChunk(chunk, onLine));
    child.stderr?.on("data", (chunk) => emitChunk(chunk, onLine));
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

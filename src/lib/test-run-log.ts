import { createWriteStream, type WriteStream } from "node:fs";
import fs from "node:fs/promises";
import {
  CONSOLE_LAST_TEST_RUN_LOG,
  testRunLogPath,
} from "./paths.ts";

export type TestRunLogHandle = Readonly<{
  path: string;
  writeLine: (line: string) => void;
  close: () => Promise<void>;
}>;

async function mirrorToLastRunLog(sourcePath: string): Promise<void> {
  try {
    await fs.copyFile(sourcePath, CONSOLE_LAST_TEST_RUN_LOG);
  } catch {
    // Best-effort convenience path; the timestamped file is the source of truth.
  }
}

/**
 * Open a timestamped transcript under `~/.local/console/test-runs/` and keep
 * {@link CONSOLE_LAST_TEST_RUN_LOG} updated when the handle closes.
 */
export async function openTestRunLog(
  repoId: string,
  suiteId: string,
  options: {
    resolvePath?: typeof testRunLogPath;
  } = {},
): Promise<TestRunLogHandle | null> {
  const resolvePath = options.resolvePath ?? testRunLogPath;
  const path = resolvePath(repoId, suiteId);

  try {
    await fs.mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true });
  } catch {
    return null;
  }

  let stream: WriteStream;
  try {
    stream = createWriteStream(path, { flags: "a", encoding: "utf8" });
  } catch {
    return null;
  }

  let closed = false;
  const writeLine = (line: string) => {
    if (closed) {
      return;
    }
    stream.write(`${line}\n`);
  };

  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });
    await mirrorToLastRunLog(path);
  };

  writeLine(`# turbopanel console test run`);
  writeLine(`# repo=${repoId}`);
  writeLine(`# suite=${suiteId}`);
  writeLine(`# started=${new Date().toISOString()}`);
  writeLine(`# log=${path}`);
  writeLine(`# last=${CONSOLE_LAST_TEST_RUN_LOG}`);
  writeLine("");

  return { path, writeLine, close };
}

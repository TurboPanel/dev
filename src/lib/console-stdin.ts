import { openSync } from "node:fs";
import type { ReadStream } from "node:tty";

/** Use the controlling terminal when stdin is piped (e.g. curl | sh → ./console). */
export function openConsoleStdin(): ReadStream {
  if (process.stdin.isTTY) {
    return process.stdin as ReadStream;
  }

  try {
    return openSync("/dev/tty", "r") as unknown as ReadStream;
  } catch {
    return process.stdin as ReadStream;
  }
}

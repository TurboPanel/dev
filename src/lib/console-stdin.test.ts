import { openSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const fsActual = await vi.importActual<typeof import("node:fs")>("node:fs");

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    openSync: vi.fn(actual.openSync),
  };
});

import { openConsoleStdin } from "./console-stdin.ts";

const mockedOpenSync = vi.mocked(openSync);

function withStdinTty<T>(isTTY: boolean, fn: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: isTTY,
  });
  try {
    return fn();
  } finally {
    if (previous) {
      Object.defineProperty(process.stdin, "isTTY", previous);
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  }
}

beforeEach(() => {
  mockedOpenSync.mockReset();
  mockedOpenSync.mockImplementation(fsActual.openSync);
});

afterEach(() => {
  mockedOpenSync.mockReset();
  mockedOpenSync.mockImplementation(fsActual.openSync);
});

test("openConsoleStdin returns process.stdin when it is a TTY", () => {
  withStdinTty(true, () => {
    expect(openConsoleStdin()).toBe(process.stdin);
    expect(mockedOpenSync).not.toHaveBeenCalled();
  });
});

test("openConsoleStdin opens /dev/tty when stdin is not a TTY", () => {
  const fakeFd = 99 as unknown as ReturnType<typeof openSync>;
  mockedOpenSync.mockReturnValue(fakeFd);
  withStdinTty(false, () => {
    expect(openConsoleStdin()).toBe(fakeFd);
    expect(mockedOpenSync).toHaveBeenCalledWith("/dev/tty", "r");
  });
});

test("openConsoleStdin falls back to process.stdin when /dev/tty fails", () => {
  mockedOpenSync.mockImplementation(() => {
    throw new Error("no tty");
  });
  withStdinTty(false, () => {
    expect(openConsoleStdin()).toBe(process.stdin);
  });
});

import { expect, test } from "vitest";
import { formatAnsibleHostFailure } from "./ansible-failure.ts";

test("formatAnsibleHostFailure joins stderr detail with msg when distinct", () => {
  const text = formatAnsibleHostFailure({
    localhost: {
      msg: "non-zero return code",
      stderr: "apt-get: failed to lock",
    },
  });
  expect(text).toBe("non-zero return code\napt-get: failed to lock");
});

test("formatAnsibleHostFailure prefers stderr over stdout", () => {
  const text = formatAnsibleHostFailure({
    host: {
      msg: "failed",
      stdout: "stdout only",
      stderr: "stderr wins",
    },
  });
  expect(text).toContain("stderr wins");
  expect(text).not.toContain("stdout only");
});

test("formatAnsibleHostFailure uses detail alone when msg is empty or duplicated", () => {
  expect(
    formatAnsibleHostFailure({
      a: { stderr: "only detail" },
    }),
  ).toBe("only detail");
  expect(
    formatAnsibleHostFailure({
      a: {
        msg: "same text",
        stderr: "same text\nmore",
      },
    }),
  ).toBe("same text\nmore");
});

test("formatAnsibleHostFailure falls back to msg or default", () => {
  expect(
    formatAnsibleHostFailure({
      a: { msg: "  just a message  " },
    }),
  ).toBe("just a message");
  expect(formatAnsibleHostFailure({})).toBe("task failed");
});

test("formatAnsibleHostFailure clips oversized detail to the trailing window", () => {
  const detail = `${"x".repeat(4500)}TAIL`;
  const text = formatAnsibleHostFailure({
    a: { stderr: detail },
  });
  expect(text.length).toBe(4000);
  expect(text.endsWith("TAIL")).toBe(true);
  expect(text.startsWith("x")).toBe(true);
});

test("formatAnsibleHostFailure joins multiple hosts with blank lines", () => {
  const text = formatAnsibleHostFailure({
    a: { msg: "first" },
    b: { msg: "second" },
  });
  expect(text).toBe("first\n\nsecond");
});

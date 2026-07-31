import { expect, test } from "vitest";
import { shellQuote } from "./shell-quote.ts";

test("shellQuote wraps plain values in single quotes", () => {
  expect(shellQuote("hello")).toBe("'hello'");
  expect(shellQuote("a b c")).toBe("'a b c'");
});

test("shellQuote escapes embedded single quotes with String.raw '\\'' sequence", () => {
  expect(shellQuote("it's")).toBe(String.raw`'it'\''s'`);
});

test("shellQuote replaces every embedded single quote (replaceAll)", () => {
  expect(shellQuote("a'b'c")).toBe(String.raw`'a'\''b'\''c'`);
});

test("shellQuote handles the empty string", () => {
  expect(shellQuote("")).toBe("''");
});

test("shellQuote leaves $, backticks, backslashes, and newlines unescaped inside quotes", () => {
  expect(shellQuote("$HOME")).toBe("'$HOME'");
  expect(shellQuote("x`y`z")).toBe("'x`y`z'");
  expect(shellQuote(String.raw`a\b`)).toBe(String.raw`'a\b'`);
  expect(shellQuote("line1\nline2")).toBe("'line1\nline2'");
});

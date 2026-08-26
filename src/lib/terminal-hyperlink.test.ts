import { expect, test } from "vitest";
import { formatTerminalHyperlink } from "./terminal-hyperlink.ts";

test("formatTerminalHyperlink wraps the URL as both target and label by default", () => {
  const url = "https://localhost:8443";
  expect(formatTerminalHyperlink(url)).toBe(
    `\u001b]8;;${url}\u001b\\${url}\u001b]8;;\u001b\\`,
  );
});

test("formatTerminalHyperlink uses an explicit label when provided", () => {
  const url = "https://localhost:8880";
  expect(formatTerminalHyperlink(url, "Open console")).toBe(
    `\u001b]8;;${url}\u001b\\Open console\u001b]8;;\u001b\\`,
  );
});

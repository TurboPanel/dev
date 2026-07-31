import { expect, test } from "vitest";
import {
  EXTERNAL_LOG_TAIL_LINES,
  resolveServiceLogPager,
} from "./service-log-pager.ts";
import {
  convergeServiceLogPath,
  DAEMON_ERR_LOG_PATH,
  DAEMON_LOG_PATH,
} from "./paths.ts";

test("resolveServiceLogPager returns null for unknown services with no log source", () => {
  const pager = resolveServiceLogPager("no-such-service", EXTERNAL_LOG_TAIL_LINES, {
    pathExists: () => false,
    hasCommand: () => true,
  });
  expect(pager).toBeNull();
});

test("resolveServiceLogPager prefers less +F on existing file logs", () => {
  const pager = resolveServiceLogPager("daemon", 500, {
    pathExists: (path) => path === DAEMON_LOG_PATH || path === DAEMON_ERR_LOG_PATH,
    pathSize: () => 100,
    hasCommand: (name) => name === "less",
  });
  expect(pager).toBeTruthy();
  expect(pager!.command).toBe("less");
  expect(pager!.args.includes("+F")).toBe(true);
  expect(pager!.args.includes(DAEMON_LOG_PATH)).toBe(true);
  expect(pager!.args.includes(DAEMON_ERR_LOG_PATH)).toBe(true);
  // Main log should be the first buffer (before .err.log).
  const logIndex = pager!.args.indexOf(DAEMON_LOG_PATH);
  const errIndex = pager!.args.indexOf(DAEMON_ERR_LOG_PATH);
  expect(logIndex).toBeLessThan(errIndex);
  expect(pager!.keys.some((line) => line.includes("Ctrl+X"))).toBe(true);
  expect(pager!.keys.some((line) => line.includes("q"))).toBe(true);
});

test("resolveServiceLogPager skips empty converge log when service logs exist", () => {
  const converge = convergeServiceLogPath("daemon");
  const pager = resolveServiceLogPager("daemon", 500, {
    pathExists: (path) =>
      path === DAEMON_LOG_PATH || path === DAEMON_ERR_LOG_PATH || path === converge,
    pathSize: (path) => (path === converge ? 0 : 100),
    hasCommand: (name) => name === "less",
  });
  expect(pager).toBeTruthy();
  expect(pager!.args.includes(converge)).toBe(false);
  expect(pager!.args.includes(DAEMON_LOG_PATH)).toBe(true);
});

test("resolveServiceLogPager falls back to tail -F when less is missing", () => {
  const pager = resolveServiceLogPager("daemon", 250, {
    pathExists: (path) => path === DAEMON_LOG_PATH,
    pathSize: () => 100,
    hasCommand: () => false,
  });
  expect(pager).toBeTruthy();
  expect(pager!.command).toBe("tail");
  expect(pager!.args.slice(0, 3)).toEqual(["-n", "250", "-F"]);
  expect(pager!.args.includes(DAEMON_LOG_PATH)).toBe(true);
});

test("resolveServiceLogPager uses docker logs for container-backed services", () => {
  const pager = resolveServiceLogPager("db", 100, {
    pathExists: () => false,
    hasCommand: (name) => name === "less",
    dockerInvoker: () => ["docker"],
  });
  expect(pager).toBeTruthy();
  expect(pager!.command).toBe("sh");
  expect(pager!.args[0]).toBe("-c");
  expect(pager!.args[1] ?? "").toMatch(
    /'docker' logs -f --tail '100' 'turbopanel-database' 2>&1 \| less -R \+F$/,
  );
  expect(pager!.keys.some((line) => line.includes("Ctrl+X"))).toBe(true);
});

test("resolveServiceLogPager uses journalctl when only a unit is available", () => {
  const pager = resolveServiceLogPager("cache", EXTERNAL_LOG_TAIL_LINES, {
    pathExists: () => false,
    hasCommand: () => false,
    journalInvoker: () => ["journalctl"],
  });
  expect(pager).toBeTruthy();
  expect(pager!.command).toBe("journalctl");
  expect(pager!.args).toEqual([
    "-u",
    "turbopanel-redis",
    "-n",
    String(EXTERNAL_LOG_TAIL_LINES),
    "-f",
    "-o",
    "cat",
  ]);
});

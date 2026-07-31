import { expect, test } from "vitest";
import type { DaemonLogLine } from "./daemon-log.ts";
import {
  daemonLogLineKey,
  daemonLogLinesEqual,
  followLogScrollIndex,
  serviceLogLineKey,
  serviceLogLinesEqual,
} from "./log-lines-equal.ts";
import type { ServiceLogLine } from "./service-log.ts";

function serviceLine(
  partial: Partial<ServiceLogLine> & { text: string },
): ServiceLogLine {
  return partial;
}

function daemonLine(
  partial: Partial<DaemonLogLine> & Pick<DaemonLogLine, "message">,
): DaemonLogLine {
  return {
    time: partial.time ?? "t",
    level: partial.level ?? "info",
    component: partial.component ?? "c",
    message: partial.message,
    err: partial.err,
  };
}

test("serviceLogLinesEqual detects length mismatch", () => {
  expect(serviceLogLinesEqual([serviceLine({ text: "a" })], [])).toBe(false);
});

test("serviceLogLinesEqual detects per-field differences", () => {
  const a = [serviceLine({ text: "a", time: "1" })];
  expect(serviceLogLinesEqual(a, [serviceLine({ text: "b", time: "1" })])).toBe(
    false,
  );
  expect(serviceLogLinesEqual(a, [serviceLine({ text: "a", time: "2" })])).toBe(
    false,
  );
});

test("serviceLogLinesEqual returns true for identical arrays", () => {
  const lines = [serviceLine({ text: "a", time: "1" }), serviceLine({ text: "b" })];
  expect(serviceLogLinesEqual(lines, [...lines])).toBe(true);
});

test("daemonLogLinesEqual detects length mismatch and per-field differences", () => {
  const base = daemonLine({ message: "m", time: "t", level: "info", component: "c" });
  expect(daemonLogLinesEqual([base], [])).toBe(false);
  expect(
    daemonLogLinesEqual([base], [daemonLine({ ...base, time: "other" })]),
  ).toBe(false);
  expect(
    daemonLogLinesEqual([base], [daemonLine({ ...base, level: "error" })]),
  ).toBe(false);
  expect(
    daemonLogLinesEqual([base], [daemonLine({ ...base, component: "x" })]),
  ).toBe(false);
  expect(
    daemonLogLinesEqual([base], [daemonLine({ ...base, message: "other" })]),
  ).toBe(false);
  expect(
    daemonLogLinesEqual([base], [daemonLine({ ...base, err: "boom" })]),
  ).toBe(false);
});

test("daemonLogLinesEqual returns true for identical arrays", () => {
  const lines = [
    daemonLine({ message: "a", err: "e" }),
    daemonLine({ message: "b" }),
  ];
  expect(daemonLogLinesEqual(lines, lines.map((line) => ({ ...line })))).toBe(
    true,
  );
});

test("serviceLogLineKey and daemonLogLineKey shapes handle nullish fields", () => {
  expect(serviceLogLineKey(serviceLine({ text: "hi" }), 3)).toBe("3::hi");
  expect(serviceLogLineKey(serviceLine({ text: "hi", time: "T" }), 1)).toBe(
    "1:T:hi",
  );
  expect(
    daemonLogLineKey(
      daemonLine({ time: "T", component: "c", message: "m" }),
      2,
    ),
  ).toBe("T:c:m::2");
  expect(
    daemonLogLineKey(
      daemonLine({ time: "T", component: "c", message: "m", err: "e" }),
      0,
    ),
  ).toBe("T:c:m:e:0");
});

test("followLogScrollIndex pins to the tail and clamps scrolled-up indices", () => {
  expect(followLogScrollIndex(5, 0)).toBe(0);
  expect(followLogScrollIndex(9, 10)).toBe(9);
  expect(followLogScrollIndex(8, 10)).toBe(9);
  expect(followLogScrollIndex(3, 10)).toBe(3);
  expect(followLogScrollIndex(99, 5)).toBe(4);
});

import { expect, test } from "vitest";
import { serviceListSpecialAction } from "./service-actions.ts";

test("serviceListSpecialAction maps L to logs on every service", () => {
  expect(serviceListSpecialAction("daemon", "L")).toBe("logs");
  expect(serviceListSpecialAction("db", "l")).toBe("logs");
});

test("serviceListSpecialAction maps T to tests only on source services", () => {
  expect(serviceListSpecialAction("daemon", "t")).toBe("tests");
  expect(serviceListSpecialAction("instance", "T")).toBe("tests");
  expect(serviceListSpecialAction("web", "t")).toBe("tests");
  expect(serviceListSpecialAction("ui", "t")).toBe("tests");
  expect(serviceListSpecialAction("website", "t")).toBe("tests");
  expect(serviceListSpecialAction("db", "t")).toBeNull();
  expect(serviceListSpecialAction("smtp", "t")).toBeNull();
});

test("serviceListSpecialAction maps U to rebuild remotes only on the daemon", () => {
  expect(serviceListSpecialAction("daemon", "u")).toBe("rebuild-remotes");
  expect(serviceListSpecialAction("instance", "u")).toBeNull();
});

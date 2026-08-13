import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  DEFAULT_OPTIONAL_DEV_SERVICES,
  assertOptionalDevServiceId,
  defaultOptionalSelection,
  normalizeOptionalSelection,
  optionalServicesOrchestrationEnv,
  readOptionalDevServices,
  writeOptionalDevServices,
} from "./optional-dev-services.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempPrefsPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "tp-optional-"));
  tempDirs.push(dir);
  return join(dir, "optional-services.json");
}

test("defaults enable studio, ui, and website only", () => {
  expect(DEFAULT_OPTIONAL_DEV_SERVICES).toEqual({
    dbstudio: true,
    ui: true,
    website: true,
    redisinsight: false,
    tabix: false,
  });
});

test("normalizeOptionalSelection fills missing keys from defaults", () => {
  expect(normalizeOptionalSelection({ ui: false, tabix: true })).toEqual({
    dbstudio: true,
    ui: false,
    website: true,
    redisinsight: false,
    tabix: true,
  });
});

test("normalizeOptionalSelection ignores invalid payloads", () => {
  expect(normalizeOptionalSelection(null)).toEqual(defaultOptionalSelection());
  expect(normalizeOptionalSelection("nope")).toEqual(defaultOptionalSelection());
  expect(normalizeOptionalSelection({ ui: "yes" })).toEqual(
    defaultOptionalSelection(),
  );
});

test("read/write round-trips preferences", () => {
  const path = tempPrefsPath();
  const selection = {
    ...defaultOptionalSelection(),
    website: false,
    redisinsight: true,
  };
  writeOptionalDevServices(selection, path);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(selection);
  expect(readOptionalDevServices(path)).toEqual(selection);
});

test("readOptionalDevServices returns defaults when file missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-optional-miss-"));
  tempDirs.push(dir);
  expect(readOptionalDevServices(join(dir, "missing.json"))).toEqual(
    defaultOptionalSelection(),
  );
});

test("optionalServicesOrchestrationEnv emits TURBOPANEL_OPTIONAL_* flags", () => {
  const env = optionalServicesOrchestrationEnv({
    dbstudio: true,
    ui: false,
    website: true,
    redisinsight: false,
    tabix: true,
  });
  expect(env).toEqual([
    "TURBOPANEL_OPTIONAL_DBSTUDIO=true",
    "TURBOPANEL_OPTIONAL_UI=false",
    "TURBOPANEL_OPTIONAL_WEBSITE=true",
    "TURBOPANEL_OPTIONAL_REDIS_INSIGHT=false",
    "TURBOPANEL_OPTIONAL_TABIX=true",
  ]);
});

test("assertOptionalDevServiceId rejects unknown ids", () => {
  expect(assertOptionalDevServiceId("ui")).toBe("ui");
  expect(() => assertOptionalDevServiceId("daemon")).toThrow(TypeError);
});

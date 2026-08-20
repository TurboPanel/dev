import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  DEFAULT_OPTIONAL_DEV_SERVICES,
  applyOptionalDevServices,
  assertOptionalDevServiceId,
  defaultOptionalSelection,
  normalizeOptionalSelection,
  optionalDevServiceCatalogIdsForRuntime,
  optionalServicesOrchestrationEnv,
  persistOptionalServiceToggle,
  readOptionalDevServices,
  writeOptionalDevServices,
} from "./optional-dev-services.ts";
import {
  MAILPIT_CONTAINER_NAME,
  REDIS_INSIGHT_BRIDGE_CONTAINER_NAME,
  REDIS_INSIGHT_CONTAINER_NAME,
} from "./platform-docker-resources.ts";

const tempDirs: string[] = [];

vi.mock("./install-output.ts", () => ({
  runCaptured: vi.fn(async () => 0),
}));

vi.mock("./spawn-trusted.ts", () => ({
  spawnSyncTrustedText: vi.fn(() => ({ status: 0, stdout: "loaded" })),
}));

vi.mock("./docker-access.ts", () => ({
  spawnDocker: vi.fn(() => ({ status: 0, stdout: "true" })),
}));

import { runCaptured } from "./install-output.ts";
import { spawnDocker } from "./docker-access.ts";
import { spawnSyncTrustedText } from "./spawn-trusted.ts";

const mockedRunCaptured = vi.mocked(runCaptured);
const mockedSpawnDocker = vi.mocked(spawnDocker);
const mockedSpawnSyncTrustedText = vi.mocked(spawnSyncTrustedText);

beforeEach(() => {
  mockedRunCaptured.mockClear();
  mockedSpawnDocker.mockClear();
  mockedSpawnSyncTrustedText.mockClear();
  mockedRunCaptured.mockResolvedValue(0);
  mockedSpawnDocker.mockReturnValue({
    status: 0,
    stdout: "true",
    stderr: "",
    pid: 0,
    output: ["", "true", ""],
    signal: null,
  });
  mockedSpawnSyncTrustedText.mockReturnValue({
    status: 0,
    stdout: "loaded",
    stderr: "",
    pid: 0,
    output: ["", "loaded", ""],
    signal: null,
  });
});

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

test("defaults enable ui, website, and mailpit", () => {
  expect(DEFAULT_OPTIONAL_DEV_SERVICES).toEqual({
    dbstudio: false,
    smtp: true,
    ui: true,
    website: true,
    redisinsight: false,
    tabix: false,
  });
});

test("normalizeOptionalSelection fills missing keys from defaults", () => {
  expect(normalizeOptionalSelection({ ui: false, tabix: true })).toEqual({
    dbstudio: false,
    smtp: true,
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
    smtp: false,
    ui: false,
    website: true,
    redisinsight: false,
    tabix: true,
  });
  expect(env).toEqual([
    "TURBOPANEL_OPTIONAL_DBSTUDIO=true",
    "TURBOPANEL_OPTIONAL_MAILPIT=false",
    "TURBOPANEL_OPTIONAL_UI=false",
    "TURBOPANEL_OPTIONAL_WEBSITE=true",
    "TURBOPANEL_OPTIONAL_REDIS_INSIGHT=false",
    "TURBOPANEL_OPTIONAL_TABIX=true",
  ]);
});

test("assertOptionalDevServiceId rejects unknown ids", () => {
  expect(assertOptionalDevServiceId("ui")).toBe("ui");
  expect(assertOptionalDevServiceId("smtp")).toBe("smtp");
  expect(() => assertOptionalDevServiceId("daemon")).toThrow(TypeError);
});

test("persistOptionalServiceToggle writes E/X into prefs", () => {
  const path = tempPrefsPath();
  expect(persistOptionalServiceToggle("dbstudio", true, path)).toEqual({
    ...defaultOptionalSelection(),
    dbstudio: true,
  });
  expect(readOptionalDevServices(path).dbstudio).toBe(true);
  expect(persistOptionalServiceToggle("smtp", false, path)?.smtp).toBe(false);
  expect(persistOptionalServiceToggle("daemon", true, path)).toBeNull();
});

test("optionalDevServiceCatalogIdsForRuntime omits Deno-only tools on Workers", () => {
  expect(optionalDevServiceCatalogIdsForRuntime("deno")).toContain("tabix");
  expect(optionalDevServiceCatalogIdsForRuntime("deno")).toContain(
    "redisinsight",
  );
  expect(optionalDevServiceCatalogIdsForRuntime("workers")).not.toContain(
    "tabix",
  );
  expect(optionalDevServiceCatalogIdsForRuntime("workers")).not.toContain(
    "redisinsight",
  );
});

test("applyOptionalDevServices stops docker-backed containers when unit is disabled", async () => {
  await applyOptionalDevServices({ ...defaultOptionalSelection(), smtp: false });

  const dockerCalls = mockedRunCaptured.mock.calls
    .map(([cmd]) => cmd)
    .filter((cmd): cmd is string[] => Array.isArray(cmd) && cmd.includes("docker"));

  expect(
    dockerCalls.some(
      (cmd) =>
        cmd.includes("update") &&
        cmd.includes("--restart=no") &&
        cmd.includes(MAILPIT_CONTAINER_NAME),
    ),
  ).toBe(true);
  expect(
    dockerCalls.some(
      (cmd) => cmd.includes("stop") && cmd.includes(MAILPIT_CONTAINER_NAME),
    ),
  ).toBe(true);
});

test("applyOptionalDevServices stops Redis Insight bridge when unit is disabled", async () => {
  await applyOptionalDevServices({
    ...defaultOptionalSelection(),
    redisinsight: false,
  });

  const dockerCalls = mockedRunCaptured.mock.calls
    .map(([cmd]) => cmd)
    .filter((cmd): cmd is string[] => Array.isArray(cmd) && cmd.includes("docker"));

  for (const container of [
    REDIS_INSIGHT_CONTAINER_NAME,
    REDIS_INSIGHT_BRIDGE_CONTAINER_NAME,
  ]) {
    expect(
      dockerCalls.some(
        (cmd) =>
          cmd.includes("update") &&
          cmd.includes("--restart=no") &&
          cmd.includes(container),
      ),
    ).toBe(true);
    expect(
      dockerCalls.some((cmd) => cmd.includes("stop") && cmd.includes(container)),
    ).toBe(true);
  }
});

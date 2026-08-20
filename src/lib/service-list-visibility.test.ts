import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { BORDER_COLOR } from "../theme.ts";
import {
  catalogOptionalIdleColor,
  catalogOptionalServiceIdsForRuntime,
  isCatalogOptionalServiceId,
  isServiceListRowVisible,
  mergeCatalogOptionalServices,
  sortServicesByCanonicalOrder,
} from "./service-list-visibility.ts";
import {
  OPTIONAL_DEV_SERVICE_IDS,
  optionalDevServiceCatalogIdsForRuntime,
} from "./optional-dev-services.ts";

const devRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const daemonRolesRoot = join(
  devRoot,
  "../turbopaneld/orchestration/roles",
);

test("catalog optional ids mirror optional dev service definitions", () => {
  expect([...optionalDevServiceCatalogIdsForRuntime("deno")].sort((a, b) =>
    a.localeCompare(b)
  )).toEqual([...OPTIONAL_DEV_SERVICE_IDS].sort((a, b) => a.localeCompare(b)));
});

test("workers runtime omits Deno-only optional catalog rows", () => {
  expect(catalogOptionalServiceIdsForRuntime("deno")).toEqual([
    "dbstudio",
    "smtp",
    "ui",
    "website",
    "redisinsight",
    "tabix",
  ]);
  expect(catalogOptionalServiceIdsForRuntime("workers")).toEqual([
    "dbstudio",
    "smtp",
    "ui",
    "website",
  ]);
  expect(catalogOptionalServiceIdsForRuntime("workers")).not.toContain(
    "redisinsight",
  );
  expect(catalogOptionalServiceIdsForRuntime("workers")).not.toContain("tabix");
});

test("isCatalogOptionalServiceId accepts optional service ids", () => {
  for (const id of OPTIONAL_DEV_SERVICE_IDS) {
    expect(isCatalogOptionalServiceId(id)).toBe(true);
  }
  expect(isCatalogOptionalServiceId("daemon")).toBe(false);
});

test("catalog optionals stay visible when uninstalled or pending", () => {
  expect(isServiceListRowVisible({ id: "dbstudio", status: "uninstalled" }))
    .toBe(true);
  expect(isServiceListRowVisible({ id: "smtp", status: "pending" })).toBe(
    true,
  );
  expect(isServiceListRowVisible({ id: "tabix", status: "stopped" })).toBe(
    true,
  );
  expect(
    isServiceListRowVisible({ id: "redisinsight", status: "uninstalled" }),
  ).toBe(true);
  expect(isServiceListRowVisible({ id: "ui", status: "uninstalled" })).toBe(
    true,
  );
});

test("non-catalog pending/uninstalled rows stay hidden unless converging", () => {
  expect(isServiceListRowVisible({ id: "cache", status: "uninstalled" })).toBe(
    false,
  );
  expect(isServiceListRowVisible({ id: "cache", status: "pending" })).toBe(
    false,
  );
  expect(isServiceListRowVisible({ id: "cache", status: "pending" }, true)).toBe(
    true,
  );
  expect(isServiceListRowVisible({ id: "daemon", status: "running" })).toBe(
    true,
  );
});

test("idle catalog rows use gray; active rows do not override", () => {
  expect(catalogOptionalIdleColor({ id: "dbstudio", status: "uninstalled" }))
    .toBe(BORDER_COLOR);
  expect(catalogOptionalIdleColor({ id: "smtp", status: "stopped" })).toBe(
    BORDER_COLOR,
  );
  expect(catalogOptionalIdleColor({ id: "tabix", status: "pending" })).toBe(
    BORDER_COLOR,
  );
  expect(
    catalogOptionalIdleColor({ id: "redisinsight", status: "uninstalled" }),
  ).toBe(BORDER_COLOR);
  expect(catalogOptionalIdleColor({ id: "tabix", status: "running" })).toBeNull();
  expect(catalogOptionalIdleColor({ id: "tabix", status: "failed" })).toBeNull();
  expect(catalogOptionalIdleColor({ id: "cache", status: "stopped" })).toBeNull();
});

test("mergeCatalogOptionalServices injects missing catalog rows in order", () => {
  const merged = mergeCatalogOptionalServices(
    [
      { id: "instance", label: "instance", status: "running" },
      { id: "daemon", label: "daemon", status: "running" },
    ],
    "deno",
  );
  expect(merged.map((service) => service.id)).toEqual([
    "instance",
    "daemon",
    "dbstudio",
    "ui",
    "website",
    "smtp",
    "redisinsight",
    "tabix",
  ]);
  expect(merged.find((service) => service.id === "smtp")?.status).toBe(
    "uninstalled",
  );
  expect(merged.find((service) => service.id === "redisinsight")?.status).toBe(
    "uninstalled",
  );
});

test("mergeCatalogOptionalServices does not duplicate existing rows", () => {
  const merged = mergeCatalogOptionalServices(
    [
      { id: "daemon", label: "daemon", status: "running" },
      { id: "smtp", label: "smtp", status: "stopped" },
    ],
    "workers",
  );
  expect(merged.filter((service) => service.id === "smtp")).toHaveLength(1);
  expect(merged.some((service) => service.id === "tabix")).toBe(false);
  expect(merged.some((service) => service.id === "redisinsight")).toBe(false);
  expect(merged.find((service) => service.id === "smtp")?.status).toBe(
    "stopped",
  );
});

test("sortServicesByCanonicalOrder keeps unknown ids after known ones", () => {
  const sorted = sortServicesByCanonicalOrder([
    { id: "tabix", label: "tabix", status: "stopped" },
    { id: "zzz", label: "zzz", status: "running" },
    { id: "daemon", label: "daemon", status: "running" },
  ]);
  expect(sorted.map((service) => service.id)).toEqual([
    "daemon",
    "tabix",
    "zzz",
  ]);
});

test("docker-backed optional roles gate readiness and stop disabled containers", () => {
  const roles = [
    {
      role: "mailpit",
      optionalVar: "turbopanel_optional_mailpit",
      containers: ["mailpit_container_name"],
    },
    {
      role: "tabix",
      optionalVar: "turbopanel_optional_tabix",
      containers: ["tabix_container_name"],
    },
    {
      role: "redis-insight",
      optionalVar: "turbopanel_optional_redis_insight",
      containers: [
        "redis_insight_bridge_container_name",
        "redis_insight_container_name",
      ],
    },
  ] as const;

  for (const { role, optionalVar, containers } of roles) {
    const tasks = readFileSync(
      join(daemonRolesRoot, role, "tasks/main.yml"),
      "utf8",
    );
    expect(tasks).toContain(`when: ${optionalVar}`);
    expect(tasks).toContain("wrapper-start.sh");
    expect(tasks).toContain('argv: [docker, update, "--restart=no"');
    expect(tasks).toContain("argv: [docker, stop,");
    for (const container of containers) {
      expect(tasks).toContain(`"{{ ${container} }}"`);
    }
  }
});

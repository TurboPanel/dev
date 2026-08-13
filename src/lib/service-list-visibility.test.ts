import { expect, test } from "vitest";
import { BORDER_COLOR } from "../theme.ts";
import {
  CATALOG_OPTIONAL_SERVICE_IDS,
  catalogOptionalIdleColor,
  catalogOptionalServiceIdsForRuntime,
  isCatalogOptionalServiceId,
  isServiceListRowVisible,
  mergeCatalogOptionalServices,
  sortServicesByCanonicalOrder,
} from "./service-list-visibility.ts";

test("catalog optional ids are drizzle studio, mailpit, and tabix", () => {
  expect([...CATALOG_OPTIONAL_SERVICE_IDS].sort((a, b) => a.localeCompare(b)))
    .toEqual(["dbstudio", "smtp", "tabix"]);
});

test("isCatalogOptionalServiceId accepts only catalog rows", () => {
  expect(isCatalogOptionalServiceId("dbstudio")).toBe(true);
  expect(isCatalogOptionalServiceId("smtp")).toBe(true);
  expect(isCatalogOptionalServiceId("tabix")).toBe(true);
  expect(isCatalogOptionalServiceId("ui")).toBe(false);
  expect(isCatalogOptionalServiceId("daemon")).toBe(false);
});

test("workers runtime omits tabix from the catalog", () => {
  expect(catalogOptionalServiceIdsForRuntime("deno")).toEqual([
    "dbstudio",
    "smtp",
    "tabix",
  ]);
  expect(catalogOptionalServiceIdsForRuntime("workers")).toEqual([
    "dbstudio",
    "smtp",
  ]);
});

test("catalog optionals stay visible when uninstalled or pending", () => {
  expect(isServiceListRowVisible({ id: "dbstudio", status: "uninstalled" }))
    .toBe(true);
  expect(isServiceListRowVisible({ id: "smtp", status: "pending" })).toBe(true);
  expect(isServiceListRowVisible({ id: "tabix", status: "stopped" })).toBe(true);
});

test("non-catalog pending/uninstalled rows stay hidden unless converging", () => {
  expect(isServiceListRowVisible({ id: "ui", status: "uninstalled" })).toBe(
    false,
  );
  expect(isServiceListRowVisible({ id: "ui", status: "pending" })).toBe(false);
  expect(isServiceListRowVisible({ id: "ui", status: "pending" }, true)).toBe(
    true,
  );
  expect(isServiceListRowVisible({ id: "ui", status: "stopped" })).toBe(true);
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
  expect(catalogOptionalIdleColor({ id: "tabix", status: "running" })).toBe(
    null,
  );
  expect(catalogOptionalIdleColor({ id: "tabix", status: "failed" })).toBe(
    null,
  );
  expect(catalogOptionalIdleColor({ id: "ui", status: "stopped" })).toBe(null);
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
    "smtp",
    "tabix",
  ]);
  expect(merged.find((service) => service.id === "smtp")?.status).toBe(
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

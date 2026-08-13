import type { DevService, DevServiceStatus } from "../dev-services.ts";
import { BORDER_COLOR } from "../theme.ts";

/**
 * Optional GUIs that stay on the Services list after converge even when
 * they are not enabled. Gray until started.
 */
export const CATALOG_OPTIONAL_SERVICE_IDS = [
  "dbstudio",
  "smtp",
  "tabix",
] as const;

export type CatalogOptionalServiceId =
  (typeof CATALOG_OPTIONAL_SERVICE_IDS)[number];

const SERVICE_LIST_ORDER = [
  "instance",
  "daemon",
  "web",
  "dbstudio",
  "ui",
  "website",
  "db",
  "smtp",
  "cache",
  "redisinsight",
  "queue",
  "analytics",
  "tabix",
] as const;

export function isCatalogOptionalServiceId(
  id: string,
): id is CatalogOptionalServiceId {
  return (CATALOG_OPTIONAL_SERVICE_IDS as readonly string[]).includes(id);
}

export function catalogOptionalServiceIdsForRuntime(
  runtime: "deno" | "workers",
): readonly CatalogOptionalServiceId[] {
  if (runtime === "workers") {
    return ["dbstudio", "smtp"];
  }
  return CATALOG_OPTIONAL_SERVICE_IDS;
}

export function isServiceListRowVisible(
  service: { id: string; status: DevServiceStatus },
  inConverge = false,
): boolean {
  if (isCatalogOptionalServiceId(service.id)) {
    return true;
  }
  switch (service.status) {
    case "running":
    case "starting":
    case "failed":
    case "stopped":
      return true;
    default:
      return inConverge;
  }
}

function catalogOptionalIsActive(status: DevServiceStatus): boolean {
  return status === "running" || status === "starting" || status === "failed";
}

/** Gray list color when a catalog optional is present but not enabled. */
export function catalogOptionalIdleColor(
  service: Pick<DevService, "id" | "status">,
): string | null {
  if (
    isCatalogOptionalServiceId(service.id) &&
    !catalogOptionalIsActive(service.status)
  ) {
    return BORDER_COLOR;
  }
  return null;
}

export function mergeCatalogOptionalServices(
  services: DevService[],
  runtime: "deno" | "workers",
): DevService[] {
  const ids = new Set(services.map((service) => service.id));
  const extras: DevService[] = [];
  for (const id of catalogOptionalServiceIdsForRuntime(runtime)) {
    if (!ids.has(id)) {
      extras.push({ id, label: id, status: "uninstalled" });
    }
  }
  if (extras.length === 0) {
    return services;
  }
  return sortServicesByCanonicalOrder([...services, ...extras]);
}

export function sortServicesByCanonicalOrder(
  services: DevService[],
): DevService[] {
  return [...services].sort((a, b) => {
    const order = SERVICE_LIST_ORDER as readonly string[];
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    const av = ai === -1 ? order.length : ai;
    const bv = bi === -1 ? order.length : bi;
    if (av !== bv) {
      return av - bv;
    }
    return a.id.localeCompare(b.id);
  });
}

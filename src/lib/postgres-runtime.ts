import {
  stackBadgeLabel,
  stackBadgeReserveForRuntime,
} from "./stack-versions.ts";

export { POSTGRES_VERSION } from "./stack-versions.ts";

export const POSTGRES_BADGE_RESERVE = stackBadgeReserveForRuntime("postgres", {
  instanceRuntime: "workers",
});

export function postgresTransportForInstanceRuntime(
  runtime: "deno" | "workers",
): "socket" | "tcp" {
  return runtime === "workers" ? "tcp" : "socket";
}

export function postgresBadgeLabel(runtime: "deno" | "workers"): string {
  return stackBadgeLabel("postgres", { instanceRuntime: runtime });
}

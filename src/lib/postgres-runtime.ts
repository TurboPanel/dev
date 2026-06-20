import {
  POSTGRES_VERSION,
  stackBadgeLabel,
  stackBadgeReserveForRuntime,
} from "./stack-versions.ts";

export { POSTGRES_VERSION };

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

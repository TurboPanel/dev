import { DENO_VERSION } from "./paths.ts";

/** daemon orchestration/roles/caddy/defaults/main.yml */
export const CADDY_VERSION = "2.10.2";

/** daemon orchestration/roles/node-runtime/defaults/main.yml */
export const NODE_VERSION = "24.17.0";

/** instance/package.json devDependencies.wrangler */
export const WRANGLER_VERSION = "4.109.0";

/** website/package.json dependencies.next */
export const NEXT_VERSION = "16.2.9";

/** ui/package.json dependencies.expo */
export const EXPO_SDK_VERSION = "56.0.16";

/** daemon orchestration/roles/postgres/defaults/main.yml postgres_image */
export const POSTGRES_VERSION = "18";

/** daemon orchestration/roles/redis/defaults/main.yml */
export const REDIS_VERSION = "8.0.2";

/** daemon orchestration/roles/rabbitmq/defaults/main.yml rabbitmq_image */
export const RABBITMQ_VERSION = "4";

export type StackBadgeRuntime =
  | "deno"
  | "workers"
  | "expo"
  | "postgres"
  | "caddy"
  | "node"
  | "next"
  | "mailpit"
  | "redis"
  | "redisinsight"
  | "rabbitmq"
  | "analytics"
  | "tabix";

/** Cloud emoji + double space — terminals often swallow one space after ☁️. */
function cloudLabel(text: string): string {
  return `☁️  ${text}`;
}

function dockerLabel(text: string): string {
  return `${text} on docker 🐳`;
}

export function stackBadgeLabel(
  runtime: StackBadgeRuntime,
  options?: {
    serviceId?: string;
    instanceRuntime?: "deno" | "workers";
  },
): string {
  const instanceRuntime = options?.instanceRuntime ?? "deno";

  switch (runtime) {
    case "postgres": {
      const transport = instanceRuntime === "workers" ? "tcp" : "socket";
      const postgresDocker = dockerLabel(`postgres ${POSTGRES_VERSION}`);
      return `${postgresDocker} via ${transport}`;
    }
    case "mailpit":
      return dockerLabel("Mailpit");
    case "redis":
      return `redis ${REDIS_VERSION}`;
    case "redisinsight":
      return dockerLabel("Redis Insight");
    case "rabbitmq":
      return dockerLabel(`rabbitmq ${RABBITMQ_VERSION}`);
    case "analytics":
      return "analytics";
    case "tabix":
      return dockerLabel("Tabix");
    case "expo":
      return `Expo ${EXPO_SDK_VERSION}`;
    case "caddy":
      return `caddy ${CADDY_VERSION}`;
    case "node":
      return `node ${NODE_VERSION}`;
    case "next":
      if (options?.serviceId === "website") {
        return cloudLabel(`next ${NEXT_VERSION}`);
      }
      return `next ${NEXT_VERSION}`;
    case "workers":
      return cloudLabel(`wrangler ${WRANGLER_VERSION}`);
    case "deno":
      return `🦕 deno ${DENO_VERSION}`;
  }
}

export function stackBadgeReserve(label: string): number {
  return Math.max(24, label.length + 2);
}

export function stackBadgeReserveForRuntime(
  runtime: StackBadgeRuntime,
  options?: {
    serviceId?: string;
    instanceRuntime?: "deno" | "workers";
  },
): number {
  return stackBadgeReserve(stackBadgeLabel(runtime, options));
}

export const INSTANCE_BADGE_RESERVE = Math.max(
  stackBadgeReserveForRuntime("deno"),
  stackBadgeReserveForRuntime("workers"),
);

export const POSTGRES_BADGE_RESERVE = stackBadgeReserveForRuntime("postgres", {
  instanceRuntime: "workers",
});

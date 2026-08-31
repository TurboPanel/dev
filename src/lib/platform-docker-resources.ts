/** Current Postgres container/volume (daemon `postgres` role defaults). */
export const POSTGRES_CONTAINER_NAME = "turbopanel-database";
export const POSTGRES_VOLUME_NAME = "turbopanel-database";

/** Current RabbitMQ container/volume (daemon `rabbitmq` role defaults). */
export const RABBITMQ_CONTAINER_NAME = "turbopanel-queue";
export const RABBITMQ_VOLUME_NAME = "turbopanel-queue";

/** Dev Mailpit container (daemon `mailpit` role default; no named volume). */
export const MAILPIT_CONTAINER_NAME = "turbopanel-dev-mailpit";

/** Dev Redis Insight container (daemon `redis-insight` role default). */
export const REDIS_INSIGHT_CONTAINER_NAME = "turbopanel-dev-redis-insight";
export const REDIS_INSIGHT_BRIDGE_CONTAINER_NAME =
  "turbopanel-dev-redis-insight-bridge";
export const REDIS_INSIGHT_VOLUME_NAME = "turbopanel-dev-redis-insight";

/** All TurboPanel-owned containers that can survive across dev installs. */
export const PLATFORM_DOCKER_CONTAINER_NAMES = [
  POSTGRES_CONTAINER_NAME,
  RABBITMQ_CONTAINER_NAME,
  MAILPIT_CONTAINER_NAME,
  REDIS_INSIGHT_BRIDGE_CONTAINER_NAME,
  REDIS_INSIGHT_CONTAINER_NAME,
] as const;

/** All TurboPanel-owned volumes that can repopulate fresh installs. */
export const PLATFORM_DOCKER_VOLUME_NAMES = [
  POSTGRES_VOLUME_NAME,
  RABBITMQ_VOLUME_NAME,
  REDIS_INSIGHT_VOLUME_NAME,
] as const;

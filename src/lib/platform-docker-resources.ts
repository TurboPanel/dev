/** Current Postgres container/volume (daemon `postgres` role defaults). */
export const POSTGRES_CONTAINER_NAME = "turbopaneldb";
export const POSTGRES_VOLUME_NAME = "turbopaneldb";

/** Current RabbitMQ container/volume (daemon `rabbitmq` role defaults). */
export const RABBITMQ_CONTAINER_NAME = "turbopanelq";
export const RABBITMQ_VOLUME_NAME = "turbopanelq";

/** Dev Mailpit container (daemon `mailpit` role default; no named volume). */
export const MAILPIT_CONTAINER_NAME = "turbopanelmailpit";

/** Dev Redis Insight container (daemon `redis-insight` role default). */
export const REDIS_INSIGHT_CONTAINER_NAME = "turbopanelredisinsight";
export const REDIS_INSIGHT_BRIDGE_CONTAINER_NAME = "turbopanelredisinsight-bridge";
export const REDIS_INSIGHT_VOLUME_NAME = "turbopanelredisinsight";

/** Dev Tabix container (daemon `tabix` role default; no named volume). */
export const TABIX_CONTAINER_NAME = "turbopaneltabix";

/** ClickHouse container/volume (daemon `clickhouse` role defaults). */
export const CLICKHOUSE_CONTAINER_NAME = "turbopanelch";
export const CLICKHOUSE_VOLUME_NAME = "turbopanelch";

/** All TurboPanel-owned containers that can survive across dev installs. */
export const PLATFORM_DOCKER_CONTAINER_NAMES = [
  POSTGRES_CONTAINER_NAME,
  RABBITMQ_CONTAINER_NAME,
  MAILPIT_CONTAINER_NAME,
  REDIS_INSIGHT_BRIDGE_CONTAINER_NAME,
  REDIS_INSIGHT_CONTAINER_NAME,
  TABIX_CONTAINER_NAME,
  CLICKHOUSE_CONTAINER_NAME,
] as const;

/** All TurboPanel-owned volumes that can repopulate fresh installs. */
export const PLATFORM_DOCKER_VOLUME_NAMES = [
  POSTGRES_VOLUME_NAME,
  RABBITMQ_VOLUME_NAME,
  REDIS_INSIGHT_VOLUME_NAME,
  CLICKHOUSE_VOLUME_NAME,
] as const;

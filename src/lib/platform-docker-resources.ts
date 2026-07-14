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

/** Dev Tabix container (daemon `tabix` role default; no named volume). */
export const TABIX_CONTAINER_NAME = "turbopanel-dev-tablix";

/** ClickHouse / analytics container/volume (daemon `clickhouse` role defaults). */
export const CLICKHOUSE_CONTAINER_NAME = "turbopanel-analytics";
export const CLICKHOUSE_VOLUME_NAME = "turbopanel-analytics";

/**
 * Pre-rename names — purged only by explicit destructive reset/purge paths
 * (never during normal converge).
 */
const LEGACY_POSTGRES_CONTAINER_NAMES = [
  "turbopaneldb",
  "turbopanel-db",
  "turbopanel-postgres",
] as const;
const LEGACY_POSTGRES_VOLUME_NAME = "turbopaneldb";
const LEGACY_RABBITMQ_CONTAINER_NAME = "turbopanelq";
const LEGACY_RABBITMQ_VOLUME_NAME = "turbopanelq";
const LEGACY_MAILPIT_CONTAINER_NAME = "turbopanelmailpit";
const LEGACY_REDIS_INSIGHT_CONTAINER_NAME = "turbopanelredisinsight";
const LEGACY_REDIS_INSIGHT_BRIDGE_CONTAINER_NAME =
  "turbopanelredisinsight-bridge";
const LEGACY_REDIS_INSIGHT_VOLUME_NAME = "turbopanelredisinsight";
const LEGACY_TABIX_CONTAINER_NAME = "turbopaneltabix";
const LEGACY_CLICKHOUSE_CONTAINER_NAME = "turbopanela";
const LEGACY_CLICKHOUSE_VOLUME_NAME = "turbopanela";
/** Older ClickHouse rename — still purged on reset. */
const LEGACY_CLICKHOUSE_CH_CONTAINER_NAME = "turbopanelch";
const LEGACY_CLICKHOUSE_CH_VOLUME_NAME = "turbopanelch";

/** All TurboPanel-owned containers that can survive across dev installs. */
export const PLATFORM_DOCKER_CONTAINER_NAMES = [
  POSTGRES_CONTAINER_NAME,
  RABBITMQ_CONTAINER_NAME,
  MAILPIT_CONTAINER_NAME,
  REDIS_INSIGHT_BRIDGE_CONTAINER_NAME,
  REDIS_INSIGHT_CONTAINER_NAME,
  TABIX_CONTAINER_NAME,
  CLICKHOUSE_CONTAINER_NAME,
  ...LEGACY_POSTGRES_CONTAINER_NAMES,
  LEGACY_RABBITMQ_CONTAINER_NAME,
  LEGACY_MAILPIT_CONTAINER_NAME,
  LEGACY_REDIS_INSIGHT_BRIDGE_CONTAINER_NAME,
  LEGACY_REDIS_INSIGHT_CONTAINER_NAME,
  LEGACY_TABIX_CONTAINER_NAME,
  LEGACY_CLICKHOUSE_CONTAINER_NAME,
  LEGACY_CLICKHOUSE_CH_CONTAINER_NAME,
] as const;

/** All TurboPanel-owned volumes that can repopulate fresh installs. */
export const PLATFORM_DOCKER_VOLUME_NAMES = [
  POSTGRES_VOLUME_NAME,
  RABBITMQ_VOLUME_NAME,
  REDIS_INSIGHT_VOLUME_NAME,
  CLICKHOUSE_VOLUME_NAME,
  LEGACY_POSTGRES_VOLUME_NAME,
  LEGACY_RABBITMQ_VOLUME_NAME,
  LEGACY_REDIS_INSIGHT_VOLUME_NAME,
  LEGACY_CLICKHOUSE_VOLUME_NAME,
  LEGACY_CLICKHOUSE_CH_VOLUME_NAME,
] as const;

/** Current Postgres container/volume (daemon `postgres` role defaults). */
export const POSTGRES_CONTAINER_NAME = "turbopaneldb";
export const POSTGRES_VOLUME_NAME = "turbopaneldb";

/** Legacy Postgres names migrated by the daemon `postgres` role. */
export const POSTGRES_LEGACY_VOLUME_NAME = "turbopanel-db";
export const POSTGRES_LEGACY_CONTAINER_NAMES = [
  "turbopanel-postgres",
  "turbopanel-db",
] as const;

/** Current RabbitMQ container/volume (daemon `rabbitmq` role defaults). */
export const RABBITMQ_CONTAINER_NAME = "turbopanelq";
export const RABBITMQ_VOLUME_NAME = "turbopanelq";

/** Legacy RabbitMQ names migrated by the daemon `rabbitmq` role. */
export const RABBITMQ_LEGACY_VOLUME_NAME = "turbopanel-q";
export const RABBITMQ_LEGACY_CONTAINER_NAMES = [
  "turbopanel-rabbitmq",
  "turbopanel-q",
] as const;

/** Dev Mailpit container (daemon `mailpit` role default; no named volume). */
export const MAILPIT_CONTAINER_NAME = "turbopanelmailpit";

/** All TurboPanel-owned containers that can survive across dev installs. */
export const PLATFORM_DOCKER_CONTAINER_NAMES = [
  POSTGRES_CONTAINER_NAME,
  ...POSTGRES_LEGACY_CONTAINER_NAMES,
  RABBITMQ_CONTAINER_NAME,
  ...RABBITMQ_LEGACY_CONTAINER_NAMES,
  MAILPIT_CONTAINER_NAME,
] as const;

/** All TurboPanel-owned volumes that can repopulate fresh installs via role migration. */
export const PLATFORM_DOCKER_VOLUME_NAMES = [
  POSTGRES_VOLUME_NAME,
  POSTGRES_LEGACY_VOLUME_NAME,
  RABBITMQ_VOLUME_NAME,
  RABBITMQ_LEGACY_VOLUME_NAME,
] as const;

/** Ansible play/role name fragments → dev service IDs (most-specific first). */
const ANSIBLE_SERVICE_MAP: readonly [fragment: string, serviceId: string][] = [
  ["instance-dev-prereqs", "instance"],
  ["instance-launch", "instance"],
  ["instance-repo", "instance"],
  ["instance-build", "instance"],
  ["instance-certs", "instance"],
  ["instance-user", "instance"],
  ["turbopanel-website", "website"],
  ["turbopanel-ui", "ui"],
  ["website-repo", "website"],
  ["turbopanel-user", "daemon"],
  ["dev-host-access", "daemon"],
  ["dev-permissions", "daemon"],
  ["runtime-sockets", "daemon"],
  ["node-runtime", "daemon"],
  ["deno-runtime", "daemon"],
  ["daemon-prereqs", "daemon"],
  ["daemon-logs", "daemon"],
  ["ui-repo", "ui"],
  ["ui-build", "ui"],
  ["clickhouse", "analytics"],
  ["rabbitmq", "queue"],
  ["postgres", "db"],
  ["mailpit", "smtp"],
  ["tabix", "tabix"],
  ["dbstudio", "dbstudio"],
  ["drizzle studio", "dbstudio"],
  ["redis-insight", "redisinsight"],
  ["caddy", "caddy"],
  ["docker", "daemon"],
  ["redis", "cache"],
];

export function resolveServiceIdFromAnsibleName(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [fragment, serviceId] of ANSIBLE_SERVICE_MAP) {
    if (lower.includes(fragment)) {
      return serviceId;
    }
  }
  return null;
}

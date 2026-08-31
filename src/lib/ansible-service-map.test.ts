import { expect, test } from "vitest";
import { resolveServiceIdFromAnsibleName } from "./ansible-service-map.ts";

test("resolveServiceIdFromAnsibleName matches most-specific fragments first", () => {
  expect(resolveServiceIdFromAnsibleName("role: instance-dev-prereqs")).toBe(
    "instance",
  );
  expect(resolveServiceIdFromAnsibleName("turbopanel-website install")).toBe(
    "website",
  );
  expect(resolveServiceIdFromAnsibleName("Install turbopanel-ui")).toBe("ui");
  expect(resolveServiceIdFromAnsibleName("postgres setup")).toBe("db");
  expect(resolveServiceIdFromAnsibleName("mailpit container")).toBe("smtp");
  expect(resolveServiceIdFromAnsibleName("redis-insight bridge")).toBe(
    "redisinsight",
  );
  expect(resolveServiceIdFromAnsibleName("drizzle studio")).toBe("dbstudio");
  expect(resolveServiceIdFromAnsibleName("caddy reverse proxy")).toBe("caddy");
  expect(resolveServiceIdFromAnsibleName("rabbitmq queue")).toBe("queue");
  expect(resolveServiceIdFromAnsibleName("redis cache")).toBe("cache");
  expect(resolveServiceIdFromAnsibleName("deno-runtime pin")).toBe("daemon");
});

test("resolveServiceIdFromAnsibleName is case-insensitive", () => {
  expect(resolveServiceIdFromAnsibleName("POSTGRES role")).toBe("db");
  expect(resolveServiceIdFromAnsibleName("MAILPIT container")).toBe("smtp");
});

test("resolveServiceIdFromAnsibleName returns null when nothing matches", () => {
  expect(resolveServiceIdFromAnsibleName("unrelated playbook")).toBeNull();
  expect(resolveServiceIdFromAnsibleName("")).toBeNull();
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { siblingCheckout } from "./sibling-checkout.ts";
import {
  CADDY_VERSION,
  EXPO_SDK_VERSION,
  NEXT_VERSION,
  POSTGRES_VERSION,
  RABBITMQ_VERSION,
  REDIS_VERSION,
  WRANGLER_VERSION,
} from "./stack-versions.ts";

/** Strip a semver range prefix (`^`, `~`, `>=`) from a package.json spec. */
function bare(spec: string): string {
  return spec.replace(/^[~^>=<\s]+/, "");
}

function packageDep(repo: string, name: string): string {
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const spec = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  if (!spec) throw new TypeError(`${name} not found in ${repo}/package.json`);
  return bare(spec);
}

function roleDefault(daemon: string, role: string, key: string): string {
  const text = readFileSync(
    join(daemon, "orchestration/roles", role, "defaults/main.yml"),
    "utf8",
  );
  const match = new RegExp(`^${key}:\\s*"?([^"\\n]+?)"?\\s*$`, "m").exec(text);
  if (!match) throw new TypeError(`${key} not found in the ${role} role defaults`);
  return match[1]!;
}

const daemon = siblingCheckout("turbopaneld");
const instance = siblingCheckout("turbopanel");
const ui = siblingCheckout("ui");
const website = siblingCheckout("website");

describe("stack badge versions match the sibling pins", () => {
  it.skipIf(website === null)("Next matches website/package.json", () => {
    expect(NEXT_VERSION).toBe(packageDep(website!, "next"));
  });

  it.skipIf(ui === null)("Expo SDK matches ui/package.json", () => {
    expect(EXPO_SDK_VERSION).toBe(packageDep(ui!, "expo"));
  });

  it.skipIf(instance === null)("wrangler matches turbopanel/package.json", () => {
    expect(WRANGLER_VERSION).toBe(packageDep(instance!, "wrangler"));
  });

  it.skipIf(daemon === null)("daemon role pins match", () => {
    expect(CADDY_VERSION).toBe(roleDefault(daemon!, "caddy", "caddy_version"));
    expect(REDIS_VERSION).toBe(roleDefault(daemon!, "redis", "redis_version"));
    expect(`postgres:${POSTGRES_VERSION}`).toBe(
      roleDefault(daemon!, "postgres", "postgres_image"),
    );
    expect(roleDefault(daemon!, "rabbitmq", "rabbitmq_image")).toMatch(
      new RegExp(`^rabbitmq:${RABBITMQ_VERSION}(-|$)`),
    );
  });
});

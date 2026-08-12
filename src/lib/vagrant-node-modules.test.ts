import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const VAGRANTFILE = readFileSync(join(REPO_ROOT, "Vagrantfile"), "utf8");

describe("Vagrant node_modules layout", () => {
  test("guest-local tree nests a directory named node_modules for ESM realpath walks", () => {
    expect(VAGRANTFILE).toContain('target="${store}/node_modules"');
    expect(VAGRANTFILE).toContain("drizzle-kit → drizzle-orm");
  });

  test("bind-mounts guest-local node_modules so Turbopack does not follow an escaped symlink", () => {
    expect(VAGRANTFILE).toContain("mount --bind");
    expect(VAGRANTFILE).toContain("tp-bind-node-modules");
    expect(VAGRANTFILE).toContain("turbopanel-virtfs-node-modules.service 2>&1");
  });
});

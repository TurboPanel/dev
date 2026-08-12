import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { isUsableDaemonCheckout } from "./platform-install.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "tp-platform-install-"));
  tempRoots.push(root);
  return root;
}

describe("isUsableDaemonCheckout", () => {
  test("accepts a tree with main.ts (Vagrant mount without working .git)", () => {
    const root = tempDir();
    writeFileSync(join(root, "main.ts"), "// daemon entry\n");
    expect(isUsableDaemonCheckout(root)).toBe(true);
  });

  test("accepts a tree with orchestration/ansible.cfg", () => {
    const root = tempDir();
    mkdirSync(join(root, "orchestration"), { recursive: true });
    writeFileSync(join(root, "orchestration", "ansible.cfg"), "[defaults]\n");
    expect(isUsableDaemonCheckout(root)).toBe(true);
  });

  test("rejects an empty directory", () => {
    const root = tempDir();
    expect(isUsableDaemonCheckout(root)).toBe(false);
  });

  test("rejects a missing path", () => {
    expect(isUsableDaemonCheckout(join(tempDir(), "missing"))).toBe(false);
  });
});

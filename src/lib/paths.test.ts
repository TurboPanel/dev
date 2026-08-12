import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildPlatformRepoEntries,
  daemonRepoPath,
  DENO_VERSION,
  instanceRepoPath,
  NODE_VERSION,
  PLATFORM_REPO_DIRS,
  platformRepoEnvKey,
  platformRepoPath,
  resolveDevRoot,
  resolveRuntimesDir,
  TURBOPANEL_ROOT,
} from "./paths.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("resolveDevRoot", () => {
  test("prefers TURBOPANEL_DEV_ROOT over HOME and TURBOPANEL_ROOT", () => {
    vi.stubEnv("TURBOPANEL_DEV_ROOT", "/custom/dev-root");
    vi.stubEnv("HOME", "/home/user");
    expect(resolveDevRoot()).toBe("/custom/dev-root");
  });

  test("falls back to HOME when TURBOPANEL_DEV_ROOT is absent or whitespace", () => {
    vi.stubEnv("TURBOPANEL_DEV_ROOT", "   ");
    vi.stubEnv("HOME", "/home/user");
    expect(resolveDevRoot()).toBe("/home/user");
  });

  test("falls back to TURBOPANEL_ROOT when DEV_ROOT and HOME are absent", () => {
    vi.stubEnv("TURBOPANEL_DEV_ROOT", "");
    vi.stubEnv("HOME", "");
    expect(resolveDevRoot()).toBe(TURBOPANEL_ROOT);
  });
});

describe("platformRepoPath", () => {
  test("platformRepoEnvKey uppercases the dir name", () => {
    expect(platformRepoEnvKey("daemon")).toBe("TURBOPANEL_DAEMON_REPO");
    expect(platformRepoEnvKey("ui")).toBe("TURBOPANEL_UI_REPO");
  });

  test("honours TURBOPANEL_<DIR>_REPO override", () => {
    vi.stubEnv("TURBOPANEL_DEV_ROOT", "/dev-root");
    vi.stubEnv("TURBOPANEL_DAEMON_REPO", "/override/daemon");
    expect(platformRepoPath("daemon")).toBe("/override/daemon");
  });

  test("defaults to <devRoot>/<dir> when override is absent", () => {
    vi.stubEnv("TURBOPANEL_DEV_ROOT", "/dev-root");
    vi.stubEnv("TURBOPANEL_DAEMON_REPO", "");
    expect(platformRepoPath("daemon")).toBe("/dev-root/daemon");
  });

  test("daemonRepoPath and instanceRepoPath delegate to platformRepoPath", () => {
    vi.stubEnv("TURBOPANEL_DEV_ROOT", "/dev-root");
    vi.stubEnv("TURBOPANEL_DAEMON_REPO", "/override/daemon");
    vi.stubEnv("TURBOPANEL_INSTANCE_REPO", "/override/instance");
    expect(daemonRepoPath()).toBe("/override/daemon");
    expect(instanceRepoPath()).toBe("/override/instance");
  });

  test("buildPlatformRepoEntries returns one entry per PLATFORM_REPO_DIRS", () => {
    vi.stubEnv("TURBOPANEL_DEV_ROOT", "/dev-root");
    const entries = buildPlatformRepoEntries();
    expect(Object.keys(entries).sort((a, b) => a.localeCompare(b))).toEqual(
      PLATFORM_REPO_DIRS.map((dir) => platformRepoEnvKey(dir)).sort((a, b) =>
        a.localeCompare(b)
      ),
    );
    for (const dir of PLATFORM_REPO_DIRS) {
      expect(entries[platformRepoEnvKey(dir)]).toBe(`/dev-root/${dir}`);
    }
  });
});

describe("version pins", () => {
  test("DENO_VERSION matches the daemon deno-runtime pin", () => {
    expect(DENO_VERSION).toBe("2.9.4");
  });

  test("NODE_VERSION matches scripts/lib/paths.sh pin", () => {
    expect(NODE_VERSION).toBe("24.17.0");
  });

  test("ensureBootstrapDeno vendors Deno from dl.deno.land", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "daemon-exec.ts"), "utf8");
    expect(source).toContain("https://dl.deno.land/release/v${VERSION}/${ASSET}");
    expect(source).not.toContain(
      "https://github.com/denoland/deno/releases/download/",
    );
  });
});

describe("resolveRuntimesDir", () => {
  test("honors TURBOPANEL_RUNTIMES_DIR override", () => {
    vi.stubEnv("TURBOPANEL_RUNTIMES_DIR", "/custom/runtimes");
    expect(resolveRuntimesDir()).toBe("/custom/runtimes");
  });

  test("falls back to the default when unset", () => {
    vi.stubEnv("TURBOPANEL_RUNTIMES_DIR", "  ");
    expect(resolveRuntimesDir()).toBe("/opt/turbopanel/vendor");
  });

  test("strips trailing slashes", () => {
    vi.stubEnv("TURBOPANEL_RUNTIMES_DIR", "/custom/runtimes///");
    expect(resolveRuntimesDir()).toBe("/custom/runtimes");
  });

  test("module-load RUNTIMES_DIR / NODE_BIN / PNPM_BIN honour env via resetModules", async () => {
    vi.stubEnv("TURBOPANEL_RUNTIMES_DIR", "/stubbed/runtimes");
    vi.resetModules();
    const mod = await import("./paths.ts");
    expect(mod.RUNTIMES_DIR).toBe("/stubbed/runtimes");
    expect(mod.NODE_BIN).toBe("/stubbed/runtimes/node/current/bin/node");
    expect(mod.PNPM_BIN).toBe("/stubbed/runtimes/node/current/bin/pnpm");
  });
});

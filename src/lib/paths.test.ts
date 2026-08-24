import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildPlatformRepoEntries,
  daemonRepoPath,
  DENO_VERSION,
  instanceRepoPath,
  NODE_VERSION,
  PLATFORM_REPO_DIRS,
  platformCaCertPath,
  platformRepoEnvKey,
  platformRepoPath,
  resolveDevRoot,
  resolveRuntimesDir,
  STATE_DIR,
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
  test("platformRepoEnvKey maps checkout dirs to historical env keys", () => {
    expect(platformRepoEnvKey("turbopaneld")).toBe("TURBOPANEL_DAEMON_REPO");
    expect(platformRepoEnvKey("turbopanel")).toBe("TURBOPANEL_INSTANCE_REPO");
    expect(platformRepoEnvKey("ui")).toBe("TURBOPANEL_UI_REPO");
  });

  test("honours TURBOPANEL_DAEMON_REPO override for turbopaneld", () => {
    vi.stubEnv("TURBOPANEL_DEV_ROOT", "/dev-root");
    vi.stubEnv("TURBOPANEL_DAEMON_REPO", "/override/turbopaneld");
    expect(platformRepoPath("turbopaneld")).toBe("/override/turbopaneld");
  });

  test("defaults to <devRoot>/<dir> when override is absent", () => {
    vi.stubEnv("TURBOPANEL_DEV_ROOT", "/dev-root");
    vi.stubEnv("TURBOPANEL_DAEMON_REPO", "");
    expect(platformRepoPath("turbopaneld")).toBe("/dev-root/turbopaneld");
  });

  test("daemonRepoPath and instanceRepoPath delegate to platformRepoPath", () => {
    vi.stubEnv("TURBOPANEL_DEV_ROOT", "/dev-root");
    vi.stubEnv("TURBOPANEL_DAEMON_REPO", "/override/turbopaneld");
    vi.stubEnv("TURBOPANEL_INSTANCE_REPO", "/override/turbopanel");
    expect(daemonRepoPath()).toBe("/override/turbopaneld");
    expect(instanceRepoPath()).toBe("/override/turbopanel");
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

describe("platformCaCertPath", () => {
  test("points at the durable platform CA bundle, not the checkout certs tree", () => {
    expect(STATE_DIR).toBe("/var/lib/turbopanel");
    expect(platformCaCertPath()).toBe("/var/lib/turbopanel/tls/ca-bundle.pem");
    expect(platformCaCertPath()).not.toContain("/certs/ca.crt");
  });
});

describe("version pins", () => {
  test("DENO_VERSION matches the daemon deno-runtime pin", () => {
    expect(DENO_VERSION).toBe("2.9.5");
  });

  test("NODE_VERSION matches scripts/lib/paths.sh pin", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const pathsSh = readFileSync(join(here, "../../scripts/lib/paths.sh"), "utf8");
    const match = /^NODE_VERSION=([\d.]+)$/m.exec(pathsSh);
    if (!match) {
      throw new TypeError("could not read NODE_VERSION from scripts/lib/paths.sh");
    }
    expect(NODE_VERSION).toBe(match[1]);
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

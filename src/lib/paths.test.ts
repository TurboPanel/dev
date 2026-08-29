import { afterEach, describe, expect, it, test, vi } from "vitest";
import {
  ALL_DEV_CHECKOUT_DIRS,
  ANSIBLE_PLAYBOOK_BIN,
  buildPlatformRepoEntries,
  CONFIG_DIR,
  CONSOLE_TEST_RUN_LOG_DIR,
  convergeServiceLogPath,
  consoleLogDir,
  CONVERGE_SERVICE_LOG_DIR,
  daemonBootstrapScript,
  daemonDenoConfig,
  DAEMON_ENV_PATH,
  DAEMON_ENV_TRUNK_BRANCH_KEY,
  DAEMON_ERR_LOG_PATH,
  DAEMON_LOG_PATH,
  daemonOrchestrationScript,
  daemonRepoPath,
  DAEMON_REPO,
  DAEMON_SYSTEMD_UNIT,
  DEFAULT_RUNTIMES_DIR,
  DENO_VERSION,
  DEV_CONVERGE_STAMP_PATH,
  instanceConfigDir,
  instanceRepoPath,
  instanceRuntimeDevVarsPath,
  instanceRuntimeEnvPath,
  instanceSecretsPath,
  LOG_DIR,
  NODE_VERSION,
  PLATFORM_REPO_DIRS,
  platformCaCertPath,
  platformRepoEnvKey,
  platformRepoPath,
  PYTHON_VERSION,
  resolveDevRoot,
  resolveRuntimesDir,
  sshRepoUrl,
  STATE_DIR,
  testRunLogPath,
  TURBOPANEL_ROOT,
  TURBOPANEL_TRUNK_BRANCH,
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
    expect(platformRepoEnvKey("website")).toBe("TURBOPANEL_WEBSITE_REPO");
    expect(platformRepoEnvKey("dev")).toBe("TURBOPANEL_DEV_REPO");
  });

  test("honours TURBOPANEL_DAEMON_REPO override for turbopaneld", () => {
    vi.stubEnv("TURBOPANEL_DEV_ROOT", "/dev-root");
    vi.stubEnv("TURBOPANEL_DAEMON_REPO", "/override/turbopaneld");
    expect(platformRepoPath("turbopaneld")).toBe("/override/turbopaneld");
  });

  test("treats whitespace-only repo overrides as unset", () => {
    vi.stubEnv("TURBOPANEL_DEV_ROOT", "/dev-root");
    vi.stubEnv("TURBOPANEL_UI_REPO", "   ");
    expect(platformRepoPath("ui")).toBe("/dev-root/ui");
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
    expect(DENO_VERSION).toBe("2.9.6");
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

  test("a runtimes dir of only slashes collapses to root", () => {
    vi.stubEnv("TURBOPANEL_RUNTIMES_DIR", "///");
    expect(resolveRuntimesDir()).toBe("/");
  });

  test("module-load RUNTIMES_DIR / NODE_BIN / PNPM_BIN honour env via resetModules", async () => {
    vi.stubEnv("TURBOPANEL_RUNTIMES_DIR", "/stubbed/runtimes");
    vi.resetModules();
    const mod = await import("./paths.ts");
    expect(mod.RUNTIMES_DIR).toBe("/stubbed/runtimes");
    expect(mod.NODE_BIN).toBe("/stubbed/runtimes/node/current/bin/node");
    expect(mod.PNPM_BIN).toBe("/stubbed/runtimes/node/current/bin/pnpm");
    expect(mod.VENDORED_DENO_BIN).toBe("/stubbed/runtimes/deno/current/deno");
    expect(mod.ANSIBLE_PLAYBOOK_BIN).toBe(
      "/stubbed/runtimes/ansible/current/bin/ansible-playbook",
    );
    expect(mod.PYTHON_RUNTIME_DIR).toBe(`/stubbed/runtimes/python/${PYTHON_VERSION}`);
    expect(mod.UV_CACHE_DIR).toBe("/stubbed/runtimes/uv/cache");
  });
});

describe("FHS and checkout helpers", () => {
  it("keeps instance config under /etc/turbopanel/instance", () => {
    expect(CONFIG_DIR).toBe("/etc/turbopanel");
    expect(LOG_DIR).toBe("/var/log/turbopanel");
    expect(instanceConfigDir()).toBe("/etc/turbopanel/instance");
    expect(instanceRuntimeEnvPath()).toBe("/etc/turbopanel/instance/runtime.env");
    expect(instanceRuntimeDevVarsPath()).toBe(
      "/etc/turbopanel/instance/runtime.dev-vars",
    );
    expect(instanceSecretsPath()).toBe("/etc/turbopanel/instance/.instance_secrets");
    expect(DAEMON_ENV_PATH).toBe("/etc/turbopanel/daemon.env");
    expect(DAEMON_LOG_PATH).toBe("/var/log/turbopanel/daemon.log");
    expect(DAEMON_ERR_LOG_PATH).toBe("/var/log/turbopanel/daemon.err.log");
    expect(DEFAULT_RUNTIMES_DIR).toBe("/opt/turbopanel/vendor");
    expect(ANSIBLE_PLAYBOOK_BIN).toContain("/ansible/current/bin/ansible-playbook");
    expect(DEV_CONVERGE_STAMP_PATH).toContain("/ansible/dev-converge.stamp");
  });

  it("resolves daemon scripts from the override-aware checkout", () => {
    vi.stubEnv("TURBOPANEL_DAEMON_REPO", "/override/turbopaneld");
    expect(daemonBootstrapScript()).toBe(
      "/override/turbopaneld/scripts/bootstrap-orchestration.ts",
    );
    expect(daemonOrchestrationScript()).toBe(
      "/override/turbopaneld/scripts/run-orchestration-action.ts",
    );
    expect(daemonDenoConfig()).toBe("/override/turbopaneld/deno.json");
  });

  it("pins trunk / systemd / repo identity constants", () => {
    expect(TURBOPANEL_TRUNK_BRANCH).toBe("trunk");
    expect(DAEMON_ENV_TRUNK_BRANCH_KEY).toBe("TURBOPANEL_TRUNK_BRANCH");
    expect(DAEMON_SYSTEMD_UNIT).toBe("turbopaneld");
    expect(DAEMON_REPO).toEqual({ dir: "turbopaneld", repo: "TurboPanel/turbopaneld" });
    expect(sshRepoUrl(DAEMON_REPO.repo)).toBe("git@github.com:TurboPanel/turbopaneld.git");
    expect([...ALL_DEV_CHECKOUT_DIRS]).toEqual(["dev", ...PLATFORM_REPO_DIRS]);
  });

  it("places console logs under <devRoot>/.local/console", () => {
    vi.stubEnv("TURBOPANEL_DEV_ROOT", "/home/dev");
    expect(consoleLogDir()).toBe("/home/dev/.local/console");
  });

  it("convergeServiceLogPath joins the module-load converge log dir", () => {
    expect(convergeServiceLogPath("postgres")).toBe(
      `${CONVERGE_SERVICE_LOG_DIR}/postgres.log`,
    );
  });

  it("module-load console log dirs honour TURBOPANEL_DEV_ROOT via resetModules", async () => {
    vi.stubEnv("TURBOPANEL_DEV_ROOT", "/stubbed/home");
    vi.resetModules();
    const mod = await import("./paths.ts");
    expect(mod.CONSOLE_LOG_DIR).toBe("/stubbed/home/.local/console");
    expect(mod.CONVERGE_SERVICE_LOG_DIR).toBe("/stubbed/home/.local/console/converge");
    expect(mod.CONSOLE_LAST_TASK_ERROR_LOG).toBe(
      "/stubbed/home/.local/console/last-task-error.log",
    );
    expect(mod.CONSOLE_TEST_RUN_LOG_DIR).toBe(
      "/stubbed/home/.local/console/test-runs",
    );
    expect(mod.CONSOLE_LAST_TEST_RUN_LOG).toBe(
      "/stubbed/home/.local/console/last-test-run.log",
    );
  });

  it("testRunLogPath replaces colons in the stamp and suite id", () => {
    const at = new Date("2026-08-25T12:34:56.789Z");
    expect(testRunLogPath("turbopanel", "test:do", at)).toBe(
      `${CONSOLE_TEST_RUN_LOG_DIR}/turbopanel-test-do-2026-08-25T12-34-56.789Z.log`,
    );
  });
});

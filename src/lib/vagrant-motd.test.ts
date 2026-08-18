import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const VAGRANTFILE = readFileSync(join(REPO_ROOT, "Vagrantfile"), "utf8");
const MOTD_SH = join(REPO_ROOT, "scripts/guest/motd.sh");
const INSTALL_SH = join(REPO_ROOT, "scripts/guest/install-motd.sh");
const MOTD_SRC = readFileSync(MOTD_SH, "utf8");
const INSTALL_SRC = readFileSync(INSTALL_SH, "utf8");

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, "");
}

function shSyntax(script: string): void {
  execFileSync("sh", ["-n", script], { encoding: "utf8" });
}

function runMotd(env: NodeJS.ProcessEnv): string {
  const merged: NodeJS.ProcessEnv = { ...process.env, ...env };
  if (!("NO_COLOR" in env)) {
    delete merged.NO_COLOR;
  }
  return execFileSync("sh", [MOTD_SH], { encoding: "utf8", env: merged });
}

describe("Vagrant guest MOTD", () => {
  test("motd.sh and install-motd.sh are valid POSIX shell", () => {
    expect(() => shSyntax(MOTD_SH)).not.toThrow();
    expect(() => shSyntax(INSTALL_SH)).not.toThrow();
  });

  test("prints the T-mark lockup, console command, and control-plane URL", () => {
    const plain = stripAnsi(runMotd({ NO_COLOR: "1" }));
    expect(plain).toContain("urboPanel");
    expect(plain).toContain("~/dev/console");
    expect(plain).toContain("https://localhost:8443");
    expect(plain).toContain("Development environment");
    expect(plain).toContain("Private alpha");
    expect(plain).not.toContain("\u001B");
  });

  test("emits brand truecolor sequences when color is enabled", () => {
    const colored = runMotd({ TERM: "xterm-256color" });
    expect(colored).toContain("38;2;61;214;140");
    expect(colored).toContain("38;2;51;102;204");
  });

  test("install-motd.sh replaces Debian fragments and writes /etc/motd.d", () => {
    expect(INSTALL_SRC).toContain("/etc/motd.d/10-turbopanel");
    expect(INSTALL_SRC).toContain("chmod a-x");
    expect(INSTALL_SRC).toContain("/etc/update-motd.d");
    expect(INSTALL_SRC).toContain("ln -sfn /dev/null");
    expect(INSTALL_SRC).toContain("install-motd.sh must run as root");
  });

  test.skipIf(process.getuid?.() === 0)(
    "install-motd.sh refuses to run as a non-root user",
    () => {
      try {
        execFileSync("sh", [INSTALL_SH], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        throw new TypeError("install-motd.sh should have exited non-zero");
      } catch (error) {
        if (error instanceof TypeError) {
          throw error;
        }
        const failed = error as {
          status?: number | null;
          stderr?: string;
        };
        expect(failed.status).toBe(1);
        expect(failed.stderr ?? "").toContain("must run as root");
      }
    },
  );

  test("Vagrantfile installs the MOTD on every provision without guest-setup", () => {
    expect(VAGRANTFILE).toContain('name: "guest-motd", run: "always"');
    expect(VAGRANTFILE).toContain("scripts/guest/install-motd.sh");
    expect(VAGRANTFILE).toContain("PrintMotd no");
  });

  test("banner is rasterized from the official T-mark, not a generic figlet", () => {
    expect(MOTD_SRC).toContain("628×370");
    expect(MOTD_SRC).toContain("urboPanel");
    expect(MOTD_SRC).not.toContain("figlet");
  });
});

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

  test("waits for Vagrant shares before binding dependencies and starting services", () => {
    expect(VAGRANTFILE).toContain('while [ "$attempt" -lt 120 ]');
    expect(VAGRANTFILE).toContain('"/home/vagrant/${repo}/package.json"');
    expect(VAGRANTFILE).toContain(
      "Before=turbopanel-ui.service turbopanel-website.service turbopanel-instance.service turbopanel-dbstudio.service",
    );
  });
});

describe("Vagrant host providers", () => {
  test("uses libvirt and Debian Trixie by default on Linux", () => {
    expect(VAGRANTFILE).toContain('"libvirt"');
    expect(VAGRANTFILE).toContain('"debian/trixie64"');
    expect(VAGRANTFILE).toContain('ENV["VAGRANT_DEFAULT_PROVIDER"] ||= HOST_PROVIDER');
  });

  test("uses bidirectional VirtioFS shares with shared memory on libvirt", () => {
    expect(VAGRANTFILE).toContain('{ type: "virtiofs" }');
    expect(VAGRANTFILE).toContain('libvirt.memorybacking :source, type: "memfd"');
    expect(VAGRANTFILE).toContain('libvirt.memorybacking :access, mode: "shared"');
  });

  test("names the libvirt domain turbopanel-dev without a directory prefix", () => {
    expect(VAGRANTFILE).toContain('config.vm.define "turbopanel-dev", primary: true');
    expect(VAGRANTFILE).toContain('libvirt.default_prefix = ""');
  });

  test("forwards Drizzle Studio to its guest-loopback-only listener", () => {
    expect(VAGRANTFILE).toMatch(
      /guest:\s*4983,[\s\S]*?host:\s*4983,[\s\S]*?guest_ip:\s*"127\.0\.0\.1",[\s\S]*?host_ip:\s*"127\.0\.0\.1"/,
    );
  });

  test("sets the guest vagrant user password to vagrant", () => {
    expect(VAGRANTFILE).toContain("echo 'vagrant:vagrant' | chpasswd");
  });

  test("refreshes guest packages instead of installing curl early", () => {
    expect(VAGRANTFILE).toContain("apt-get update -qq");
    expect(VAGRANTFILE).toContain("dist-upgrade");
    expect(VAGRANTFILE).toContain("apt-get -y autoremove");
    expect(VAGRANTFILE).not.toContain("apt-get install -y -qq curl");
  });
});

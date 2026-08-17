import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const VAGRANTFILE = readFileSync(join(REPO_ROOT, "Vagrantfile"), "utf8");
const VAGRANT_UP = readFileSync(join(REPO_ROOT, "scripts/vagrant-up.sh"), "utf8");

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

  test("forwards Caddy, Expo, and website to guest loopback on LAN host binds", () => {
    expect(VAGRANTFILE).toContain("[8443, 8443]");
    expect(VAGRANTFILE).toContain("[8880, 8880]");
    expect(VAGRANTFILE).toContain("[8081, 8081]");
    expect(VAGRANTFILE).toContain("[19820, 19820]");
    expect(VAGRANTFILE).toContain('guest_ip: "127.0.0.1"');
    expect(VAGRANTFILE).toContain('host_ip: "0.0.0.0"');
    expect(VAGRANTFILE).toContain("gateway_ports: true");
  });

  test("forwards Drizzle Studio to its guest-loopback-only listener", () => {
    expect(VAGRANTFILE).toContain("[4983, 4983]");
    expect(VAGRANTFILE).toContain('host_ip: "127.0.0.1"');
  });

  test("forwards Mailpit, Redis Insight, and Tabix on host loopback", () => {
    expect(VAGRANTFILE).toContain("[8025, 8025]");
    expect(VAGRANTFILE).toContain("[5540, 5540]");
    expect(VAGRANTFILE).toContain("[8125, 8125]");
  });

  test("supervises libvirt SSH port forwards and keeps idle sshd tunnels alive", () => {
    expect(VAGRANTFILE).toContain("ssh_forward_supervisor.sh");
    expect(VAGRANTFILE).toContain("UnusedConnectionTimeout 0");
    expect(VAGRANTFILE).toContain("ServerAliveInterval=15");
    expect(VAGRANTFILE).toContain('name: "sshd-port-forward-keepalives", run: "always"');
    expect(VAGRANTFILE).toContain("stop_stale_ssh_forwards");
  });

  test("sets the guest vagrant user password to vagrant", () => {
    expect(VAGRANTFILE).toContain("echo 'vagrant:vagrant' | chpasswd");
  });

  test("refreshes guest packages instead of installing curl early", () => {
    expect(VAGRANTFILE).toContain("apt-get update -qq");
    expect(VAGRANTFILE).toContain("upgrade");
    expect(VAGRANTFILE).not.toContain("dist-upgrade");
    expect(VAGRANTFILE).toContain("apt-get -y autoremove");
    expect(VAGRANTFILE).not.toContain("apt-get install -y -qq curl");
  });
});

describe("Vagrant host sibling checkouts", () => {
  test("vagrant-up.sh requires turbopaneld/turbopanel siblings, not retired names", () => {
    expect(VAGRANT_UP).toContain(
      "for _dir in turbopaneld turbopanel ui website; do",
    );
    expect(VAGRANT_UP).not.toMatch(
      /for _dir in (daemon instance|instance daemon) /,
    );
    expect(VAGRANT_UP).not.toContain("for _dir in daemon instance ui website");
  });
});

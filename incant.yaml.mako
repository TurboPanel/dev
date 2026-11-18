<%doc>
  TurboPanel development VM on Incus, for Linux hosts (the third option next to
  Direct and Vagrant). Run incant from this dev checkout:

    incant up        create, start and provision the VM
    incant provision run the provisioning steps again
    incus shell turbopanel-dev, then: su - <you>, ~/turbopanel/dev/console
    incant destroy   delete the VM (the repos on the host are untouched)

  Mirrors the Vagrantfile: Debian 13, 2 CPUs (TURBOPANEL_INCUS_CPUS), 6 GiB,
  the sibling repos mounted at ~/turbopanel/<repo>, and the same forwarded
  ports. The guest user has the host user's name and UID, so files on the
  shares keep their owner.

  Bridged LAN mode (opt in): set TURBOPANEL_INCUS_LAN_BRIDGE=<host bridge> and
  the VM joins that bridge, gets its address by DHCP from the LAN, sends its
  hostname (TURBOPANEL_INCUS_HOSTNAME, default the instance name) in DHCP, and
  no host ports are forwarded. Unset, the NAT setup below is unchanged.
</%doc>
<%
  import os, pwd, re, shlex, socket, sys
  dev_dir = os.getcwd()
  root_dir = os.path.dirname(dev_dir)
  me = pwd.getpwuid(os.getuid())
  user, uid, gid = me.pw_name, me.pw_uid, me.pw_gid
  guest_root = "/home/%s/turbopanel" % user
  name = os.environ.get("TURBOPANEL_INCUS_NAME") or "turbopanel-dev"
  # 6 GiB; Metro is capped at a 3 GiB heap. Give more
  # when the host has room (for example TURBOPANEL_INCUS_MEMORY=10GiB).
  memory = os.environ.get("TURBOPANEL_INCUS_MEMORY", "6GiB")
  cpus = os.environ.get("TURBOPANEL_INCUS_CPUS") or "2"
  if not (cpus.isascii() and cpus.isdigit()) or int(cpus) < 1:
      raise SystemExit("incant: TURBOPANEL_INCUS_CPUS must be a positive whole number, not %r" % cpus)
  lan_bridge = os.environ.get("TURBOPANEL_INCUS_LAN_BRIDGE") or ""
  if lan_bridge and (lan_bridge[0] in "-." or not all(c.isascii() and (c.isalnum() or c in "._-") for c in lan_bridge)):
      raise SystemExit("incant: bad TURBOPANEL_INCUS_LAN_BRIDGE %r (letters, digits, '.', '_' and '-' only)" % lan_bridge)
  # Name the VM sends in DHCP. A dotted value is the FQDN: its first label is
  # the hostname, the whole name goes on the dev certificate.
  vm_host = os.environ.get("TURBOPANEL_INCUS_HOSTNAME") or name
  # Only bridged mode uses the name, so a bad value must not abort NAT mode.
  # Each label follows RFC 1123: ASCII letters, digits and '-', 1 to 63 characters,
  # not starting or ending with '-'.
  if lan_bridge and (len(vm_host) > 253 or not all(re.fullmatch(r"[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label) for label in vm_host.split("."))):
      raise SystemExit("incant: bad TURBOPANEL_INCUS_HOSTNAME %r (dot-separated labels of ASCII letters, digits and '-', at most 63 characters each, none starting or ending with '-')" % vm_host)
  short_host = vm_host.split(".")[0]

  repos = []
  with open(os.path.join(dev_dir, "repos.list")) as f:
      for line in f:
          parts = line.split()
          if not parts or parts[0].startswith("#"):
              continue
          optional = len(parts) > 2 and parts[2] == "optional"
          if os.path.isdir(os.path.join(root_dir, parts[0])) or not optional:
              repos.append(parts[0])

  # Names a second machine uses to reach the forwarded ports; the guest mints
  # the Platform CA leaf for them (same idea as the Vagrantfile).
  aliases = []
  if lan_bridge:
      # The VM has its own LAN address; the host's address is not its address.
      aliases.append(vm_host if "." in vm_host else vm_host + ".lan")
  else:
      s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
      try:
          s.connect(("192.0.2.1", 9))
          aliases.append(s.getsockname()[0])
      except OSError:
          pass
      finally:
          s.close()
  extra = os.environ.get("TURBOPANEL_DEV_LAN_ALIASES", "").replace(",", " ").split()
  path = os.path.join(dev_dir, "local", "lan-aliases")
  if os.path.isfile(path):
      with open(path) as f:
          extra += [l.strip() for l in f if l.strip() and not l.strip().startswith("#")]
  for a in extra:
      # Same rule as --lan-alias in scripts/vm-bootstrap.sh: letters, digits,
      # dot, underscore and dash only, and no leading dash or dot.
      if not a or a[0] in "-." or not all(c.isascii() and (c.isalnum() or c in "._-") for c in a):
          sys.stderr.write("incant: skipping bad LAN alias %r (letters, digits, '.', '_' and '-' only; no leading '-' or '.')" % a + "\n")
          continue
      if a not in aliases:
          aliases.append(a)
  alias_args = " ".join("--lan-alias %s" % a for a in aliases)

  # Incus forwards ports into a VM only in NAT mode, which needs a fixed guest
  # address on the bridge. Default: .10 in the bridge's subnet.
  import subprocess, ipaddress
  bridge = os.environ.get("TURBOPANEL_INCUS_BRIDGE", "incusbr0")
  guest_ip = os.environ.get("TURBOPANEL_INCUS_IPV4")
  if not guest_ip and not lan_bridge:
      try:
          net = subprocess.run(["incus", "network", "get", bridge, "ipv4.address"],
                               capture_output=True, text=True, check=True).stdout.strip()
          if net in ("", "none"):
              raise ValueError(net or "empty")
          guest_ip = str(ipaddress.ip_interface(net).network.network_address + 10)
      except (OSError, subprocess.CalledProcessError, ValueError) as e:
          raise SystemExit("incant: cannot get an IPv4 address for bridge %s (%s); set TURBOPANEL_INCUS_IPV4 to the VM's address, or TURBOPANEL_INCUS_BRIDGE to a bridge with IPv4" % (bridge, e))

  # Ports the host forwards, the same list as the Vagrantfile. All listen on
  # every host address: the Vagrantfile keeps 4983, 8025, 5540 and 4213 on
  # loopback, but forwarding host loopback into a VM by NAT needs
  # route_localnet on the host. Those four are unauthenticated dev tools
  # (database browser, mail catcher, Redis Insight), now reachable on the LAN.
  ports = [(p, "0.0.0.0") for p in (80, 443, 8443, 8081, 8088, 19820, 4983, 8025, 5540, 4213)]
  # Bridged LAN mode: the VM is on the LAN itself, so nothing is forwarded.
  # The guest redirect still covers these ports on eth0 (loopback-only services).
  guest_ports = " ".join(str(p) for p, _ in ports)
  if lan_bridge:
      ports = []
%>
instances:
  ${name}:
    image: images:debian/13
    vm: true
    wait: true
    shared_folder: false
    config:
      limits.cpu: "${cpus}"
      limits.memory: ${memory}
    devices:
      root:
        size: 64GiB
% if not lan_bridge:
      eth0:
        ipv4.address: ${guest_ip}
% endif
    pre-launch:
% if lan_bridge:
      # The default profile's eth0 names a managed network, which cannot be
      # combined with nictype, so an instance-level eth0 replaces it whole.
      - config device add ${name} eth0 nic nictype=bridged parent=${lan_bridge} name=eth0
% endif
% for repo in repos:
      - config device add ${name} repo-${repo.lstrip('.')} disk source=${root_dir}/${repo} path=${guest_root}/${repo}
% endfor
% for port, bind in ports:
      - config device add ${name} port-${port} proxy nat=true listen=tcp:${bind}:${port} connect=tcp:${guest_ip}:${port}
% endfor
    provision:
      - |
        #!/bin/sh
        set -eu
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq
        apt-get install -y -qq sudo curl ca-certificates >/dev/null
        if ! getent passwd ${user} >/dev/null; then
          getent group ${gid} >/dev/null || groupadd -g ${gid} ${user}
          useradd -m -u ${uid} -g ${gid} -s /bin/bash ${user}
        fi
        usermod -aG sudo ${user}
        # The repo shares are attached before the user exists, so Incus made
        # the home folder as root and useradd skipped the skeleton files.
        chown ${uid}:${gid} /home/${user}
        for f in /etc/skel/.[!.]*; do
          [ -e "$f" ] || continue
          b=$(basename "$f")
          [ -e "/home/${user}/$b" ] || install -o ${uid} -g ${gid} -m 0644 "$f" "/home/${user}/$b"
        done
        install -d -o ${uid} -g ${gid} -m 0755 ${guest_root}
% if root_dir != guest_root:
        # Git worktrees record the host's absolute path in their .git file; the
        # same path inside the VM lets git (and the tests) work in worktrees.
        if [ ! -e ${shlex.quote(root_dir)} ] && [ ! -L ${shlex.quote(root_dir)} ]; then
          # Root-owned parents: never re-own or re-mode a folder that exists.
          mkdir -p ${shlex.quote(os.path.dirname(root_dir))}
          ln -s ${guest_root} ${shlex.quote(root_dir)}
        fi
% endif
      - |
        #!/bin/sh
        set -eu
        TURBOPANEL_DEV_ROOT=${guest_root} sh ${guest_root}/dev/scripts/vm-bootstrap.sh --upgrade --swap ${alias_args} ${user}
      - |
        #!/bin/sh
        set -eu
% if lan_bridge:
        # DHCP sends the system hostname: make it the short name, then take a
        # fresh lease on the default-route card (its name is not always eth0).
        # Only when the hostname changes; a rerun with the same name keeps the lease.
        if [ "$(hostname)" != ${shlex.quote(short_host)} ]; then
          hostnamectl set-hostname ${shlex.quote(short_host)}
          # Keep the 127.0.1.1 entry in step so sudo can resolve the new name.
          if grep -q '^127\.0\.1\.1[[:space:]]' /etc/hosts; then
            sed -i 's/^127\.0\.1\.1[[:space:]].*/127.0.1.1 '${shlex.quote(short_host)}'/' /etc/hosts
          else
            echo '127.0.1.1 '${shlex.quote(short_host)} >> /etc/hosts
          fi
          iface=$(ip -o -4 route show default | awk '{print $5; exit}')
          [ -z "$iface" ] || networkctl reconfigure "$iface" || true
        fi
% endif
        sh ${guest_root}/dev/scripts/incus-guest-setup.sh ${user} ${guest_ports}
        sh ${guest_root}/dev/scripts/guest/install-motd.sh || true

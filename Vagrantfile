# frozen_string_literal: true

# TurboPanel development VM (libvirt on Linux, UTM on macOS).
#
# Plain `vagrant up` selects the native provider for the host. The macOS helper
# also boots the guest, then lands in the Ink console:
#   ./scripts/vagrant-up.sh
#
# Mounts sibling checkouts from the host workspace (parent of this repo) into the
# guest home so default TURBOPANEL_DEV_ROOT=$HOME matches bare-metal layout
# (confirmed against the daemon's Ansible roles: source lives at
# "<dev_root>/<repo>" whenever turbopanel_dev_user is set; /opt/turbopanel is
# vendor/bin/share only, never source).
# Guest-only FHS paths (/etc|/var|/run|/opt/turbopanel) stay on the VM disk.
#
# Linux/libvirt uses Debian 13 (debian/trixie64). macOS/UTM uses Debian 12
# (utm/bookworm) until a Debian 13 / Trixie UTM box is published.

require "rbconfig"

HOST_OS = RbConfig::CONFIG.fetch("host_os")
HOST_PROVIDER =
  if HOST_OS.match?(/linux/)
    "libvirt"
  elsif HOST_OS.match?(/darwin/)
    "utm"
  else
    raise "Unsupported Vagrant host OS: #{HOST_OS}"
  end

# Keep `vagrant up` deterministic when several providers are installed while
# still allowing an explicit VAGRANT_DEFAULT_PROVIDER override.
ENV["VAGRANT_DEFAULT_PROVIDER"] ||= HOST_PROVIDER

HOST_BOX = HOST_PROVIDER == "libvirt" ? "debian/trixie64" : "utm/bookworm"
SYNCED_FOLDER_OPTIONS = HOST_PROVIDER == "libvirt" ? { type: "virtiofs" } : {}

GITHUB_HOST_DIR = File.join(__dir__, "..", ".github")

# Conditional guest reboot after apt upgrades (pending kernel / reboot-required).
# Vagrant's shell `reboot: true` always reboots; this provisioner only reboots
# when needed and waits for SSH like the built-in reboot capability.
#
# VirtioFS mounts are applied once during `vagrant up` / `reload` and are NOT
# restored automatically after a mid-provision reboot — without remounting,
# ~/dev (and siblings) stay as empty guest-local mount-point directories.
#
# Libvirt `forwarded_port` is implemented as host-side SSH `-L` tunnels.
# Guest sshd (OpenSSH 9.8+) closes idle `-N` sessions via UnusedConnectionTimeout,
# and apt/sshd reloads during converge drop them too. `EnsureLibvirtPortForwards`
# replaces one-shot vagrant-libvirt tunnels with a restarting supervisor so
# localhost/LAN binds (8443, 8880, 8025, 4983, …) survive guest lifecycle.
module TurbopanelVagrant
  class RebootIfNeeded < Vagrant.plugin("2", :provisioner)
    def provision
      unless guest_needs_reboot?
        @machine.ui.info("No pending kernel reboot required.")
        return
      end

      @machine.ui.warn(
        "Package updates left a pending kernel reboot — rebooting the guest now."
      )
      @machine.ui.warn(
        "SSH will drop for about a minute; this is expected. Do not Ctrl-C."
      )
      @machine.ui.info(
        "Vagrant will wait until the guest is reachable again, then continue."
      )
      @machine.guest.capability(:reboot)
      # Marker is guest-local; clear after a successful reboot wait.
      @machine.communicate.sudo("rm -f /var/lib/turbopanel-dev/reboot-pending")
      remount_virtiofs_synced_folders
    end

    def guest_needs_reboot?
      script = <<~'SCRIPT'
        set -eu
        if [ -f /var/lib/turbopanel-dev/reboot-pending ] || [ -f /var/run/reboot-required ]; then
          echo TURBOPANEL_REBOOT=yes
          exit 0
        fi
        running=$(uname -r)
        newest=
        if [ -d /boot ]; then
          newest=$(ls -1 /boot/vmlinuz-* 2>/dev/null | sed 's|.*/vmlinuz-||' | sort -V | tail -n1 || true)
        fi
        if [ -n "$newest" ] && [ "$running" != "$newest" ]; then
          echo TURBOPANEL_REBOOT=yes
          exit 0
        fi
        echo TURBOPANEL_REBOOT=no
      SCRIPT
      out = +""
      @machine.communicate.sudo(script) do |type, data|
        out << data if type == :stdout
      end
      out.include?("TURBOPANEL_REBOOT=yes")
    end

    def remount_virtiofs_synced_folders
      require "json"
      require "shellwords"

      path = @machine.data_dir.join("synced_folders")
      unless path.file?
        @machine.ui.warn(
          "No synced_folders metadata; skipping VirtioFS remount after reboot."
        )
        return
      end

      folders = JSON.parse(path.read).fetch("virtiofs", {})
      if folders.empty?
        @machine.ui.info("No VirtioFS synced folders to remount.")
        return
      end

      @machine.ui.info("Remounting VirtioFS synced folders after reboot…")
      folders.each_value do |opts|
        guestpath = opts["guestpath"]
        tag = opts["mount_tag"]
        next if guestpath.to_s.empty? || tag.to_s.empty?

        # Quote for the remote shell; paths/tags are Vagrant-generated.
        gp = Shellwords.escape(guestpath)
        mt = Shellwords.escape(tag)
        @machine.communicate.sudo("mkdir -p #{gp}")
        @machine.communicate.sudo(
          "findmnt -n -o FSTYPE #{gp} 2>/dev/null | grep -qx virtiofs || " \
          "mount -t virtiofs #{mt} #{gp}"
        )
      end
    end
  end

  # vagrant-libvirt's ForwardPorts is a single `ssh -N -L` with no keepalive
  # and no restart. Replace those with a supervisor that reconnects, and
  # always target guest loopback so Caddy/Mailpit/Studio do not depend on
  # the DHCP NIC address.
  class EnsureLibvirtPortForwards < Vagrant.plugin("2", :provisioner)
    SUPERVISOR_NAME = "ssh_forward_supervisor.sh"

    def provision
      return unless @machine.provider_name.to_s == "libvirt"

      specs = forwarded_port_specs
      if specs.empty?
        @machine.ui.info("No forwarded ports configured; skipping libvirt tunnel check.")
        return
      end

      ssh_info = @machine.ssh_info
      if ssh_info.nil? || ssh_info[:host].to_s.empty?
        @machine.ui.warn(
          "Guest SSH info unavailable; skip libvirt port-forward supervisors."
        )
        return
      end

      if supervisors_healthy?(specs) && our_supervisors_running?(specs)
        @machine.ui.info(
          "Libvirt SSH port forwards already listening " \
          "(#{specs.map { |spec| spec[:host_port] }.join(', ')})."
        )
        return
      end

      @machine.ui.warn(
        "Libvirt SSH port forwards missing or dead — starting supervised " \
        "tunnels (#{specs.map { |spec| spec[:host_port] }.join(', ')})…"
      )
      stop_existing_forwards
      stop_stale_ssh_forwards(specs)
      wait_for_ports_free(specs)
      write_supervisor_script
      specs.each { |spec| start_supervisor(spec, ssh_info) }
      warn_unbound_ports(specs)
    end

    def forwarded_port_specs
      specs = []
      @machine.config.vm.networks.each do |type, options|
        next unless type == :forwarded_port
        next if options[:disabled]
        next if options[:protocol].to_s == "udp"
        if options[:id].to_s == "ssh" &&
           !@machine.provider_config.forward_ssh_port
          next
        end

        host_port = options[:host]
        guest_port = options[:guest]
        next unless host_port && guest_port

        specs << {
          host_port: host_port.to_i,
          guest_port: guest_port.to_i,
          host_ip: options[:host_ip].to_s.strip.empty? ? "*" : options[:host_ip],
          guest_ip: options[:guest_ip].to_s.strip.empty? ? "127.0.0.1" : options[:guest_ip],
          gateway_ports: options[:gateway_ports] == true,
        }
      end
      specs.sort_by { |spec| spec[:host_port] }
    end

    def supervisors_healthy?(specs)
      specs.all? { |spec| host_port_listening?(spec[:host_ip], spec[:host_port]) }
    end

    def our_supervisors_running?(specs)
      pid_dir = @machine.data_dir.join("pids")
      specs.all? do |spec|
        pid_file = pid_dir.join("ssh_#{spec[:host_port]}.pid")
        next false unless pid_file.file?

        pid = pid_file.read.strip
        next false unless pid.match?(/\A\d+\z/)

        cmd = `ps -o command= -p #{pid} 2>/dev/null`.strip
        cmd.include?(SUPERVISOR_NAME)
      end
    end

    def host_port_listening?(host_ip, host_port)
      require "socket"
      probe_ip = loopback_probe_ip(host_ip)
      begin
        Socket.tcp(probe_ip, host_port, connect_timeout: 0.4, &:close)
      rescue ArgumentError
        Socket.tcp(probe_ip, host_port, &:close)
      end
      true
    rescue StandardError
      false
    end

    def loopback_probe_ip(host_ip)
      return "127.0.0.1" if host_ip.to_s.empty? || host_ip == "*" || host_ip == "0.0.0.0"

      host_ip
    end

    def stop_existing_forwards
      pid_dir = @machine.data_dir.join("pids")
      return unless pid_dir.directory?

      Dir[pid_dir.join("ssh_*.pid").to_s].each do |path|
        pid = File.read(path).strip
        stop_pid(pid) if pid.match?(/\A\d+\z/)
        File.delete(path)
      rescue Errno::ENOENT
        next
      end
    end

    def stop_pid(pid)
      pid_i = Integer(pid)
      begin
        Process.kill("TERM", -pid_i)
      rescue Errno::ESRCH, Errno::EPERM, Errno::EINVAL
        Process.kill("TERM", pid_i)
      end
    rescue Errno::ESRCH, Errno::EPERM, ArgumentError
      nil
    end

    # Pid files can be stale after a host reboot; vagrant-libvirt's one-shot
    # `ssh -L` may still own the bind. Match the exact forward spec.
    def stop_stale_ssh_forwards(specs)
      specs.each do |spec|
        pattern = "#{spec[:host_ip]}:#{spec[:host_port]}:" \
                  "#{spec[:guest_ip]}:#{spec[:guest_port]}"
        system("pkill", "-TERM", "-f", pattern)
      end
    end

    def wait_for_ports_free(specs)
      deadline = Time.now + 3
      busy = specs.dup
      while Time.now < deadline && !busy.empty?
        busy.reject! { |spec| !host_port_listening?(spec[:host_ip], spec[:host_port]) }
        sleep 0.1 unless busy.empty?
      end
    end

    def write_supervisor_script
      path = supervisor_path
      path.write(<<~'SCRIPT')
        #!/bin/sh
        # Restart ssh -N -L until this supervisor is killed.
        # argv: ssh [args...]  (script name contains "ssh" so vagrant-libvirt
        # ClearForwardedPorts still recognises the pid on halt/destroy.)
        trap 'if [ -n "${child:-}" ]; then kill "$child" 2>/dev/null; wait "$child" 2>/dev/null; fi; exit 0' INT TERM HUP
        while true; do
          "$@" &
          child=$!
          wait "$child" || true
          child=
          sleep 2
        done
      SCRIPT
      path.chmod(0o750)
    end

    def supervisor_path
      @machine.data_dir.join(SUPERVISOR_NAME)
    end

    def start_supervisor(spec, ssh_info)
      log_dir = @machine.data_dir.join("logs")
      log_dir.mkdir unless log_dir.directory?
      pid_dir = @machine.data_dir.join("pids")
      pid_dir.mkdir unless pid_dir.directory?

      log_file = File.join(
        log_dir,
        format(
          "ssh-forwarding-%s_%s-%s_%s.log",
          spec[:host_ip], spec[:host_port], spec[:guest_ip], spec[:guest_port]
        )
      )
      ssh_cmd = ssh_forward_command(spec, ssh_info)
      pid = spawn(
        supervisor_path.to_s,
        *ssh_cmd,
        [:out, :err] => [log_file, "a"],
        pgroup: true
      )
      Process.detach(pid)
      pid_dir.join("ssh_#{spec[:host_port]}.pid").write(pid.to_s)
    end

    def ssh_forward_command(spec, ssh_info)
      params = %W(
        -n
        -L
        #{spec[:host_ip]}:#{spec[:host_port]}:#{spec[:guest_ip]}:#{spec[:guest_port]}
        -N
        #{ssh_info[:host]}
      )
      params << "-g" if spec[:gateway_ports]

      options = (
        %W(
          User=#{ssh_info[:username]}
          Port=#{ssh_info[:port]}
          UserKnownHostsFile=/dev/null
          ExitOnForwardFailure=yes
          ControlMaster=no
          StrictHostKeyChecking=no
          PasswordAuthentication=no
          ServerAliveInterval=15
          ServerAliveCountMax=4
          TCPKeepAlive=yes
          ForwardX11=#{ssh_info[:forward_x11] ? 'yes' : 'no'}
          IdentitiesOnly=#{ssh_info[:keys_only] ? 'yes' : 'no'}
        ) + ssh_info[:private_key_path].map { |pk| "IdentityFile=\"#{pk}\"" }
      ).map { |s| ["-o", s] }.flatten

      ["ssh"] + options + params
    end

    def warn_unbound_ports(specs)
      deadline = Time.now + 8
      pending = specs.dup
      while Time.now < deadline && !pending.empty?
        pending.reject! { |spec| host_port_listening?(spec[:host_ip], spec[:host_port]) }
        sleep 0.2 unless pending.empty?
      end
      return if pending.empty?

      ports = pending.map { |spec| spec[:host_port] }.join(", ")
      @machine.ui.warn(
        "Host still not listening on #{ports}. Check " \
        "#{@machine.data_dir.join('logs')} / ssh_forward_supervisor after SSH is up."
      )
    end
  end

  class Plugin < Vagrant.plugin("2")
    name "turbopanel_vagrant"
    provisioner(:turbopanel_reboot_if_needed) { RebootIfNeeded }
    provisioner(:turbopanel_ensure_libvirt_port_forwards) { EnsureLibvirtPortForwards }
  end
end

Vagrant.configure("2") do |config|
  # Libvirt domain / Vagrant machine name — avoid directory_default (dev_default).
  config.vm.define "turbopanel-dev", primary: true

  config.vm.box = HOST_BOX
  config.vm.hostname = "turbopanel-dev"

  config.ssh.forward_agent = true

  # Avoid a second mount of this repo at /vagrant; we sync into ~/dev instead.
  config.vm.synced_folder ".", "/vagrant", disabled: true

  config.vm.synced_folder ".", "/home/vagrant/dev", **SYNCED_FOLDER_OPTIONS
  config.vm.synced_folder "../turbopaneld", "/home/vagrant/turbopaneld", **SYNCED_FOLDER_OPTIONS
  config.vm.synced_folder "../turbopanel", "/home/vagrant/turbopanel", **SYNCED_FOLDER_OPTIONS
  config.vm.synced_folder "../ui", "/home/vagrant/ui", **SYNCED_FOLDER_OPTIONS
  config.vm.synced_folder "../website", "/home/vagrant/website", **SYNCED_FOLDER_OPTIONS

  # Optional: turbopanel/.github (community health files). Ansible's github-repo
  # role auto-clones this to $HOME/.github via HTTPS when absent, so only mount
  # it when you already have a sibling checkout to keep local edits in sync.
  if Dir.exist?(GITHUB_HOST_DIR)
    config.vm.synced_folder "../.github", "/home/vagrant/.github", **SYNCED_FOLDER_OPTIONS
  end

  # Bind 0.0.0.0 so the libvirt/UTM host's LAN IP can reach Caddy / website —
  # not only Cursor/localhost SSH tunnels. Always forward to guest loopback:
  # vagrant-libvirt otherwise targets the DHCP NIC (192.168.121.x), which
  # misses Mailpit/Studio/Tabix (127.0.0.1-only) and breaks when the lease
  # changes. Guest ports:
  #   8443  control-plane Caddy HTTPS
  #   8880  control-plane Caddy plaintext HTTP (dev overlay)
  #   8088  optional extra forward (guest must listen)
  #   19820 website (Next.js)
  #   4983  Drizzle Studio (unauthenticated — host loopback only)
  #   8025  Mailpit web UI (unauthenticated — host loopback only)
  #   5540  Redis Insight (unauthenticated — host loopback only)
  #   8125  Tabix (unauthenticated — host loopback only)
  #
  # Libvirt implements these as SSH `-L` tunnels (not QEMU hostfwd).
  # `gateway_ports: true` is a vagrant-libvirt option that passes ssh `-g` so
  # non-localhost clients can use the 0.0.0.0 bind; UTM ignores the key.
  [
    [8443, 8443],
    [8880, 8880],
    [8088, 8088],
    [19820, 19820],
  ].each do |guest_port, host_port|
    config.vm.network "forwarded_port",
                      guest: guest_port,
                      host: host_port,
                      guest_ip: "127.0.0.1",
                      host_ip: "0.0.0.0",
                      gateway_ports: true
  end

  [
    [4983, 4983],
    [8025, 8025],
    [5540, 5540],
    [8125, 8125],
  ].each do |guest_port, host_port|
    config.vm.network "forwarded_port",
                      guest: guest_port,
                      host: host_port,
                      guest_ip: "127.0.0.1",
                      host_ip: "127.0.0.1"
  end

  config.vm.provider "utm" do |u|
    u.name = "turbopanel-dev"
    u.cpus = 4
    u.memory = 8192
    u.directory_share_mode = "virtFS"
  end

  config.vm.provider "libvirt" do |libvirt|
    # Domain name is just the machine name (turbopanel-dev), not {cwd}_{name}.
    libvirt.default_prefix = ""
    # 4 cores / 8 threads (1 socket × 4 cores × 2 threads).
    libvirt.cpus = 8
    libvirt.cputopology sockets: "1", cores: "4", threads: "2"
    libvirt.memory = 8192
    # VirtioFS is bidirectional and avoids the NFS/rsync fallback. Libvirt
    # requires shared memory backing for VirtioFS devices. Use memfd explicitly:
    # access-only defaults to a sparse file under /var/lib/libvirt/qemu/ram,
    # which turns guest memory churn into host disk writeback and I/O stalls.
    libvirt.memorybacking :source, type: "memfd"
    libvirt.memorybacking :access, mode: "shared"
  end

  # Package upgrades can leave a pending kernel; reboot (when needed) before
  # the rest of guest setup so uname matches the installed linux-image.
  config.vm.provision "shell", name: "system-upgrade", inline: <<~SHELL
    set -eu

    export DEBIAN_FRONTEND=noninteractive

    # Console / login password for the vagrant user (local dev VM only).
    # Official boxes often ship with the account locked or a random hash;
    # set a known password before the rest of guest setup.
    echo 'vagrant:vagrant' | chpasswd
    passwd -u vagrant 2>/dev/null || true

    # Bring the box packages current, then ensure curl for ./console
    # (dev-prerequisites.sh requires it before packages.sh can apt-install).
    apt-get update -qq
    apt-get -y \
      -o Dpkg::Options::="--force-confdef" \
      -o Dpkg::Options::="--force-confold" \
      upgrade
    apt-get -y autoremove
    apt-get install -y curl

    install -d -m 0750 /var/lib/turbopanel-dev
    needs_reboot=0
    if [ -f /var/run/reboot-required ]; then
      needs_reboot=1
    fi
    running=$(uname -r)
    newest=
    if [ -d /boot ]; then
      newest=$(ls -1 /boot/vmlinuz-* 2>/dev/null | sed 's|.*/vmlinuz-||' | sort -V | tail -n1 || true)
    fi
    if [ -n "$newest" ] && [ "$running" != "$newest" ]; then
      needs_reboot=1
    fi
    if [ "$needs_reboot" -eq 1 ]; then
      printf '%s\n' "$running" > /var/lib/turbopanel-dev/reboot-pending
      if [ -n "$newest" ]; then
        printf '%s\n' "$newest" >> /var/lib/turbopanel-dev/reboot-pending
      fi
      echo ">>> System packages updated; a kernel/package reboot is pending"
      echo ">>>   running kernel: ${running}"
      echo ">>>   newest installed: ${newest:-unknown}"
    else
      rm -f /var/lib/turbopanel-dev/reboot-pending
      echo ">>> System packages updated; running kernel is current (${running})."
    fi
  SHELL

  config.vm.provision "turbopanel_reboot_if_needed"

  config.vm.provision "shell", name: "guest-setup", inline: <<~SHELL
    set -eu

    # ./console requires the dev user to be a member of the sudo/wheel/admin group
    # (scripts/lib/dev-prerequisites.sh: tp_dev_user_is_sudoer) — a direct sudoers
    # NOPASSWD rule alone does not satisfy that check.
    if ! id -nG vagrant | tr ' ' '\n' | grep -qx sudo; then
      usermod -aG sudo vagrant
    fi

    # Passwordless sudo for the Vagrant user (local dev VM only).
    SUDOERS=/etc/sudoers.d/turbopanel-dev-nopasswd
    if [ ! -f "$SUDOERS" ]; then
      cat >"$SUDOERS" <<'EOF'
# TurboPanel development passwordless sudo for vagrant
# Installed by turbopanel/dev Vagrantfile — remove this file to revert.
vagrant ALL=(ALL) NOPASSWD: ALL
EOF
      chmod 440 "$SUDOERS"
    fi

    PROFILE=/etc/profile.d/turbopanel-vagrant.sh
    cat >"$PROFILE" <<'EOF'
# TurboPanel Vagrant guest defaults (sourced for login shells).
# ./console also exports TURBOPANEL_MODE=development and repo paths under $HOME.
export TURBOPANEL_MODE="${TURBOPANEL_MODE:-development}"
# Apple Silicon hypervisors (UTM) often advertise SVE2 without implementing it;
# cryptography 47+ / OpenSSL then SIGILL on ansible-playbook. Harmless elsewhere.
export OPENSSL_armcap="${OPENSSL_armcap:-0}"
EOF
    chmod 644 "$PROFILE"

    # pnpm 11's content-addressable store is SQLite-backed (WAL mode) and, with no
    # explicit storeDir, is auto-placed inside whichever filesystem the project sits
    # on — here that is a VirtFS/9p mount from the Mac host (~/dev, ~/turbopaneld, ~/turbopanel,
    # ~/ui, ~/website are each their own 9p mount). SQLite's WAL requires shared-memory
    # mmap that 9p/virtiofs doesn't support across the VM boundary, so installs fail
    # with "[ERR_SQLITE_ERROR] disk I/O error". Force a guest-local (ext4) store instead.
    #
    # pnpm 11 also stopped reading pnpm-specific settings from .npmrc (auth/registry
    # only now) — storeDir/packageImportMethod must go in the global YAML config.
    install -d -o vagrant -g vagrant -m 0755 /var/lib/pnpm /var/lib/pnpm/store
    install -d -o vagrant -g vagrant -m 0755 /home/vagrant/.config/pnpm
    cat >/home/vagrant/.config/pnpm/config.yaml <<'EOF'
storeDir: /var/lib/pnpm/store
packageImportMethod: copy
EOF
    chown vagrant:vagrant /home/vagrant/.config/pnpm/config.yaml
    chmod 644 /home/vagrant/.config/pnpm/config.yaml

    # ARM64 + FUSE-backed filesystems (9p/virtiofs) don't invalidate the instruction
    # cache for pages faulted in from mmap'd executable files, so native Node addons
    # (esbuild, @rolldown/binding-*, lightningcss, …) SIGSEGV/SIGILL when node_modules
    # lives directly on a VirtFS mount — even though the pnpm *store* is already local.
    # Keep node_modules on guest-local ext4 via a bind mount for every mounted repo
    # that has a package.json; source stays on VirtFS for editing from the Mac.
    # A symlink is not enough: Next.js Turbopack rejects node_modules that points
    # outside the project ("Symlink … is invalid, it points out of the filesystem
    # root"), and Node ESM/CJS realpath walks miss packages unless the physical
    # path ends in /node_modules (drizzle-kit → drizzle-orm; Tamagui → typescript).
    # Ansible *-repo roles must probe a nested package (drizzle-kit / expo / next),
    # not the mount point — this directory starts empty.
    install -d -o root -g root -m 0750 /usr/local/sbin
    cat >/usr/local/sbin/tp-bind-node-modules <<'BINDSCRIPT'
#!/bin/sh
set -eu
NODE_MODULES_BASE=/var/lib/turbopanel-dev/node_modules

# Vagrant mounts VirtFS/9p shares over SSH after the guest reaches userspace;
# this systemd unit can therefore run before the mounted package.json files are
# visible. Wait for the required repo mounts instead of exiting successfully
# without installing the bind mounts.
attempt=0
while [ "$attempt" -lt 120 ]; do
  mounts_ready=1
  for repo in dev turbopanel ui website; do
    if [ ! -f "/home/vagrant/${repo}/package.json" ]; then
      mounts_ready=0
      break
    fi
  done
  [ "$mounts_ready" -eq 1 ] && break
  attempt=$((attempt + 1))
  sleep 1
done

for repo in dev turbopanel ui website; do
  repo_dir="/home/vagrant/${repo}"
  [ -f "${repo_dir}/package.json" ] || continue
  store="${NODE_MODULES_BASE}/${repo}"
  target="${store}/node_modules"
  if [ -e "${store}/.pnpm" ] && [ ! -e "${target}/.pnpm" ]; then
    # A running ./console holds the flat `dev` tree; wiping it unloads Ink.
    if [ "$repo" = "dev" ] && pgrep -u vagrant -f 'vite-node|hot-reload' >/dev/null 2>&1; then
      continue
    fi
    rm -rf "${store}"
  fi
  install -d -o vagrant -g vagrant -m 0755 "$target"
  link="${repo_dir}/node_modules"
  if mountpoint -q "$link" 2>/dev/null; then
    continue
  fi
  if [ -L "$link" ]; then
    rm -f "$link"
  elif [ -e "$link" ] && [ ! -d "$link" ]; then
    rm -f "$link"
  fi
  if [ ! -d "$link" ]; then
    mkdir -p "$link"
    chown vagrant:vagrant "$link" || true
  fi
  mount --bind "$target" "$link"
done
BINDSCRIPT
    chmod 0750 /usr/local/sbin/tp-bind-node-modules
    cat >/etc/systemd/system/turbopanel-virtfs-node-modules.service <<'UNIT'
[Unit]
Description=Bind guest-local node_modules over VirtFS checkouts
DefaultDependencies=no
After=remote-fs.target
Before=turbopanel-ui.service turbopanel-website.service turbopanel-instance.service turbopanel-dbstudio.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/tp-bind-node-modules

[Install]
WantedBy=multi-user.target
UNIT
    chmod 0640 /etc/systemd/system/turbopanel-virtfs-node-modules.service
    systemctl daemon-reload
    # `enable` prints "Created symlink …" on stderr; Vagrant colors all
    # provisioner stderr red even when the command succeeded.
    systemctl enable --now turbopanel-virtfs-node-modules.service 2>&1

    # 8 GiB swapfile when the root disk has room. Bookworm cloud images can be
    # small; filling the disk with swap makes pnpm report "disk I/O error" from
    # SQLite (typically ENOSPC). Keep a 12 GiB free reserve for vendor/runtimes.
    SWAPFILE=/swapfile
    SWAP_BYTES=$((8 * 1024 * 1024 * 1024))
    ROOT_RESERVE=$((12 * 1024 * 1024 * 1024))
    ROOT_AVAIL=$(df -B1 --output=avail / | tail -n 1 | tr -d ' ')
    SWAP_CUR=0
    if [ -f "$SWAPFILE" ]; then
      SWAP_CUR=$(stat -c%s "$SWAPFILE" 2>/dev/null || echo 0)
    fi
    # Count existing swapfile size toward avail if we're about to rebuild it.
    ROOT_EFFECTIVE=$ROOT_AVAIL
    if [ "$SWAP_CUR" -gt 0 ] && [ "$SWAP_CUR" -ne "$SWAP_BYTES" ]; then
      ROOT_EFFECTIVE=$((ROOT_AVAIL + SWAP_CUR))
    fi
    if [ "$ROOT_EFFECTIVE" -lt $((SWAP_BYTES + ROOT_RESERVE)) ]; then
      echo "Skipping ${SWAP_BYTES}-byte swapfile: root has ${ROOT_AVAIL} bytes free (need ${SWAP_BYTES}+${ROOT_RESERVE})." >&2
      if [ -f "$SWAPFILE" ]; then
        swapoff "$SWAPFILE" 2>/dev/null || true
        rm -f "$SWAPFILE"
      fi
      if grep -qE "^${SWAPFILE}[[:space:]]" /etc/fstab; then
        # Drop the stale fstab line without leaving a partial match.
        grep -vE "^${SWAPFILE}[[:space:]]" /etc/fstab >/etc/fstab.tp-new
        mv /etc/fstab.tp-new /etc/fstab
      fi
    else
      if [ "$SWAP_CUR" -ne "$SWAP_BYTES" ]; then
        if [ -f "$SWAPFILE" ]; then
          swapoff "$SWAPFILE" 2>/dev/null || true
          rm -f "$SWAPFILE"
        fi
        if ! fallocate -l "$SWAP_BYTES" "$SWAPFILE" 2>/dev/null; then
          dd if=/dev/zero of="$SWAPFILE" bs=1M count=8192 status=none
        fi
        chmod 600 "$SWAPFILE"
        mkswap "$SWAPFILE" >/dev/null
      fi
      if ! grep -q "^${SWAPFILE} " /proc/swaps 2>/dev/null; then
        swapon "$SWAPFILE"
      fi
      if ! grep -qE "^${SWAPFILE}[[:space:]]" /etc/fstab; then
        printf '%s none swap sw 0 0\n' "$SWAPFILE" >>/etc/fstab
      fi
    fi
  SHELL

  # OpenSSH 9.8+ reaps idle `ssh -N` port-forward sessions. Apply on every
  # provision so existing guests pick it up without a reload/destroy.
  config.vm.provision "shell", name: "sshd-port-forward-keepalives", run: "always", inline: <<~SHELL
    set -eu
    SSHD_DROPIN=/etc/ssh/sshd_config.d/turbopanel-vagrant.conf
    SSHD_BIN=/usr/sbin/sshd
    install -d -m 0755 /etc/ssh/sshd_config.d
    cat >"$SSHD_DROPIN" <<'EOF'
# TurboPanel Vagrant: idle SSH port-forward tunnels must not be reaped.
TCPKeepAlive yes
ClientAliveInterval 15
ClientAliveCountMax 12
MaxSessions 50
MaxStartups 30:30:100
EOF
    printf '%s\n' "UnusedConnectionTimeout 0" >>"$SSHD_DROPIN"
    if [ -x "$SSHD_BIN" ] && ! "$SSHD_BIN" -t >/dev/null 2>&1; then
      grep -v '^UnusedConnectionTimeout ' "$SSHD_DROPIN" >"${SSHD_DROPIN}.new"
      mv "${SSHD_DROPIN}.new" "$SSHD_DROPIN"
    fi
    chmod 644 "$SSHD_DROPIN"
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  SHELL

  # After guest-setup (and after any mid-provision reboot), restore libvirt SSH
  # port-forward tunnels when they are missing/dead. `run: "always"` so a later
  # `vagrant provision` also heals host binds without a full reload.
  config.vm.provision "turbopanel_ensure_libvirt_port_forwards", run: "always"
end

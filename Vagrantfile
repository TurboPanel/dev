# frozen_string_literal: true

# TurboPanel development VM (libvirt on Linux, UTM on macOS).
#
# Plain `vagrant up` selects the native provider for the host. The macOS helper
# also boots the guest, then lands in the Ink console:
#   ./scripts/vagrant-up.sh
#
# Mounts sibling checkouts from the host workspace (parent of this repo) into the
# guest home so default TURBOPANEL_DEV_ROOT=$HOME matches bare-metal layout — this
# is exactly where dev.turbopanel.sh + ./console would place them (confirmed against
# the daemon's Ansible roles: source lives at "<dev_root>/<repo>" whenever
# turbopanel_dev_user is set; /opt/turbopanel is vendor/bin/share only, never source).
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

Vagrant.configure("2") do |config|
  # Libvirt domain / Vagrant machine name — avoid directory_default (dev_default).
  config.vm.define "turbopanel-dev", primary: true

  config.vm.box = HOST_BOX
  config.vm.hostname = "turbopanel-dev"

  config.ssh.forward_agent = true

  # Avoid a second mount of this repo at /vagrant; we sync into ~/dev instead.
  config.vm.synced_folder ".", "/vagrant", disabled: true

  config.vm.synced_folder ".", "/home/vagrant/dev", **SYNCED_FOLDER_OPTIONS
  config.vm.synced_folder "../daemon", "/home/vagrant/daemon", **SYNCED_FOLDER_OPTIONS
  config.vm.synced_folder "../instance", "/home/vagrant/instance", **SYNCED_FOLDER_OPTIONS
  config.vm.synced_folder "../ui", "/home/vagrant/ui", **SYNCED_FOLDER_OPTIONS
  config.vm.synced_folder "../website", "/home/vagrant/website", **SYNCED_FOLDER_OPTIONS

  # Optional: turbopanel/.github (community health files). Ansible's github-repo
  # role auto-clones this to $HOME/.github via HTTPS when absent, so only mount
  # it when you already have a sibling checkout to keep local edits in sync.
  if Dir.exist?(GITHUB_HOST_DIR)
    config.vm.synced_folder "../.github", "/home/vagrant/.github", **SYNCED_FOLDER_OPTIONS
  end

  # Bind 0.0.0.0 so the libvirt/UTM host's LAN IP can reach guest services —
  # not only Cursor/localhost SSH tunnels. Guest ports:
  #   8443  control-plane Caddy HTTPS
  #   8880  control-plane Caddy plaintext HTTP (dev overlay)
  #   8088  optional extra forward (guest must listen)
  #   19820 website (Next.js)
  #   4983  Drizzle Studio
  [
    [8443, 8443],
    [8880, 8880],
    [8088, 8088],
    [19820, 19820],
    [4983, 4983],
  ].each do |guest_port, host_port|
    config.vm.network "forwarded_port",
                      guest: guest_port,
                      host: host_port,
                      host_ip: "0.0.0.0"
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

  config.vm.provision "shell", inline: <<~SHELL
    set -eu

    export DEBIAN_FRONTEND=noninteractive

    # Console / login password for the vagrant user (local dev VM only).
    # Official boxes often ship with the account locked or a random hash;
    # set a known password before the rest of guest setup.
    echo 'vagrant:vagrant' | chpasswd
    passwd -u vagrant 2>/dev/null || true

    # Bring the box packages current before guest setup. curl (and other
    # host tools) are left to ./console / develop.sh when needed.
    apt-get update -qq
    apt-get -y \
      -o Dpkg::Options::="--force-confdef" \
      -o Dpkg::Options::="--force-confold" \
      upgrade
    apt-get -y \
      -o Dpkg::Options::="--force-confdef" \
      -o Dpkg::Options::="--force-confold" \
      dist-upgrade
    apt-get -y autoremove

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
    # on — here that is a VirtFS/9p mount from the Mac host (~/dev, ~/daemon, ~/instance,
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
for repo in dev instance ui website; do
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
Before=turbopanel-ui.service turbopanel-website.service turbopanel-instance.service

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
end

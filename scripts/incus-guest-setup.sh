#!/bin/sh
# Shared-folder setup for an Incus dev VM whose repos are mounted from the host
# (incant.yaml.mako). Run as root inside the guest, after vm-bootstrap.sh:
#
#   sh scripts/incus-guest-setup.sh DEV_USER [PORT...]
#
# PORTs are the ports the host forwards into the VM. Incus forwards into a VM
# only by NAT to the guest's own address, while several dev services listen on
# 127.0.0.1 only; each PORT arriving on the guest's network card is redirected
# to 127.0.0.1, which is what Vagrant's forwards did (guest_ip 127.0.0.1).
#
# Does the two parts of the Vagrant guest setup that only matter when the repos
# sit on a virtiofs share, for any dev user rather than "vagrant":
#   1. a guest-local pnpm store (pnpm's SQLite store fails on virtiofs), and
#   2. guest-local node_modules bind-mounted over each repo's node_modules
#      (native addons and Turbopack break on virtiofs and on symlinks).
# Safe to run again. See the Vagrantfile guest-setup step for the background.
set -eu

DEV_USER=${1:-}
if [ -z "$DEV_USER" ] || [ "$DEV_USER" = root ]; then
  echo "incus-guest-setup: name the dev user." >&2
  exit 2
fi
shift
PORTS=
for port in "$@"; do
  case "$port" in
    '' | *[!0-9]*) echo "incus-guest-setup: bad port: $port" >&2; exit 2 ;;
    *) ;;
  esac
  if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
    echo "incus-guest-setup: bad port: $port" >&2
    exit 2
  fi
  PORTS="${PORTS:+${PORTS}, }${port}"
done
case "$DEV_USER" in
  *[!A-Za-z0-9._-]* | -*) echo "incus-guest-setup: bad user name: $DEV_USER" >&2; exit 2 ;;
  *) ;;
esac
[ "$(id -u)" -eq 0 ] || { echo "incus-guest-setup: run as root." >&2; exit 1; }
DEV_HOME=$(getent passwd "$DEV_USER" | cut -d: -f6)
[ -n "$DEV_HOME" ] || { echo "incus-guest-setup: no such user: $DEV_USER" >&2; exit 1; }
DEV_GROUP=$(id -gn "$DEV_USER")
DEV_ROOT="${DEV_HOME}/turbopanel"

echo ">>> Guest-local pnpm store for ${DEV_USER}"
install -d -o "$DEV_USER" -g "$DEV_GROUP" -m 0755 /var/lib/pnpm /var/lib/pnpm/store
install -d -o "$DEV_USER" -g "$DEV_GROUP" -m 0755 "${DEV_HOME}/.config" "${DEV_HOME}/.config/pnpm"
cat >"${DEV_HOME}/.config/pnpm/config.yaml" <<'EOF'
storeDir: /var/lib/pnpm/store
packageImportMethod: copy
EOF
chown "$DEV_USER:$DEV_GROUP" "${DEV_HOME}/.config/pnpm/config.yaml"
chmod 644 "${DEV_HOME}/.config/pnpm/config.yaml"

echo ">>> Guest-local node_modules bind mounts"
install -d -m 0755 /var/lib/turbopanel-dev
install -d -o root -g root -m 0750 /usr/local/sbin
# DEV_USER and DEV_ROOT were checked above, so they are safe to write unquoted.
cat >/usr/local/sbin/tp-bind-node-modules <<BINDSCRIPT
#!/bin/sh
# Written by scripts/incus-guest-setup.sh for ${DEV_USER}.
set -eu
NODE_MODULES_BASE=/var/lib/turbopanel-dev/node_modules
REPOS_DIR=${DEV_ROOT}

# Incus attaches the shares before boot, but wait briefly anyway so a slow
# virtiofs start does not leave the repos without their bind mounts.
attempt=0
while [ "\$attempt" -lt 120 ]; do
  mounts_ready=1
  for repo in dev turbopanel ui website; do
    if [ ! -f "\${REPOS_DIR}/\${repo}/package.json" ]; then
      mounts_ready=0
      break
    fi
  done
  [ "\$mounts_ready" -eq 1 ] && break
  attempt=\$((attempt + 1))
  sleep 1
done

for repo in dev turbopanel ui website; do
  repo_dir="\${REPOS_DIR}/\${repo}"
  [ -f "\${repo_dir}/package.json" ] || continue
  store="\${NODE_MODULES_BASE}/\${repo}"
  target="\${store}/node_modules"
  if [ -e "\${store}/.pnpm" ] && [ ! -e "\${target}/.pnpm" ]; then
    # A running ./console holds the flat dev tree; wiping it unloads Ink.
    if [ "\$repo" = "dev" ] && pgrep -u ${DEV_USER} -f 'vite-node|hot-reload' >/dev/null 2>&1; then
      continue
    fi
    rm -rf "\${store}"
  fi
  install -d -o ${DEV_USER} -g ${DEV_GROUP} -m 0755 "\$target"
  link="\${repo_dir}/node_modules"
  if mountpoint -q "\$link" 2>/dev/null; then
    continue
  fi
  if [ -L "\$link" ]; then
    rm -f "\$link"
  elif [ -e "\$link" ] && [ ! -d "\$link" ]; then
    rm -f "\$link"
  fi
  if [ ! -d "\$link" ]; then
    mkdir -p "\$link"
    chown ${DEV_USER}:${DEV_GROUP} "\$link" || true
  fi
  mount --bind "\$target" "\$link"
done
BINDSCRIPT
chmod 0750 /usr/local/sbin/tp-bind-node-modules

cat >/etc/systemd/system/turbopanel-virtfs-node-modules.service <<'UNIT'
[Unit]
Description=Bind guest-local node_modules over the shared repo checkouts
DefaultDependencies=no
After=remote-fs.target local-fs.target
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
systemctl enable turbopanel-virtfs-node-modules.service 2>&1
systemctl restart turbopanel-virtfs-node-modules.service

echo ">>> Metro polls the share every 2 s"
# ui/metro.config.js polls a virtiofs share (host edits raise no inotify event)
# every 400 ms by default; a full walk of the ui tree that often keeps about
# half a core busy. 2 s costs a short delay before Fast Refresh instead.
install -d -m 0755 /etc/systemd/system/turbopanel-ui.service.d
cat >/etc/systemd/system/turbopanel-ui.service.d/poll-interval.conf <<'EOF'
[Service]
# Written by scripts/incus-guest-setup.sh.
Environment=TURBOPANEL_METRO_POLL_MS=2000
EOF
systemctl daemon-reload

if [ -n "$PORTS" ]; then
  echo ">>> Forwarded ports reach services on 127.0.0.1: ${PORTS}"
  command -v nft >/dev/null 2>&1 || apt-get install -y -qq nftables >/dev/null
  # Loopback is reachable from the network card only with route_localnet.
  cat >/etc/sysctl.d/60-turbopanel-incus.conf <<'EOF'
# Written by scripts/incus-guest-setup.sh: lets forwarded ports reach 127.0.0.1.
net.ipv4.conf.all.route_localnet = 1
EOF
  sysctl -q -p /etc/sysctl.d/60-turbopanel-incus.conf
  # PORTS was checked above (digits only), so it is safe to write unquoted.
  cat >/usr/local/sbin/tp-incus-forward <<FORWARD
#!/bin/sh
# Written by scripts/incus-guest-setup.sh. Own table, so Docker's rules and
# this one never touch each other; runs before Docker's DNAT.
set -eu
IFACE=\$(ip -4 route show default | awk '{for(i=1;i<=NF;i++) if(\$i=="dev") {print \$(i+1); exit}}')
[ -n "\$IFACE" ] || { echo "tp-incus-forward: no default route" >&2; exit 1; }
nft list table ip turbopanel_incus >/dev/null 2>&1 && nft delete table ip turbopanel_incus
nft -f - <<NFT
table ip turbopanel_incus {
  chain prerouting {
    type nat hook prerouting priority dstnat - 10; policy accept;
    iifname "\$IFACE" tcp dport { ${PORTS} } dnat to 127.0.0.1
  }
}
NFT
FORWARD
  chmod 0750 /usr/local/sbin/tp-incus-forward
  cat >/etc/systemd/system/turbopanel-incus-forward.service <<'UNIT'
[Unit]
Description=Redirect ports forwarded by Incus to services on 127.0.0.1
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/tp-incus-forward

[Install]
WantedBy=multi-user.target
UNIT
  chmod 0644 /etc/systemd/system/turbopanel-incus-forward.service
  systemctl daemon-reload
  systemctl enable turbopanel-incus-forward.service 2>&1
  systemctl restart turbopanel-incus-forward.service
fi
echo ">>> Done"

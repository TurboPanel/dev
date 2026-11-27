#!/bin/sh
# Shared-folder setup for an Incus dev VM whose repos are mounted from the host
# (incant.yaml.mako). Run as root inside the guest, after vm-bootstrap.sh:
#
#   sh scripts/incus-guest-setup.sh DEV_USER [PORT...]
#
# PORTs are the ports the VM serves. Incus forwards into a VM only by NAT to
# the guest's own address (and in bridged LAN mode clients dial the guest's
# own LAN address), while several dev services listen on 127.0.0.1 only; each
# PORT arriving on the guest's default-route network card (eth0 in both modes)
# is redirected to 127.0.0.1, which is what Vagrant's forwards did.
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
case "$DEV_HOME" in
  /*) ;;
  *) echo "incus-guest-setup: home folder is not an absolute path: $DEV_HOME" >&2; exit 2 ;;
esac
case "$DEV_HOME" in
  *[!A-Za-z0-9._/-]* | *//* | */../* | */.. | */./* | */.)
    echo "incus-guest-setup: unsafe home folder: $DEV_HOME" >&2; exit 2 ;;
  *) ;;
esac
case "$DEV_GROUP" in
  '' | *[!A-Za-z0-9._-]* | -*) echo "incus-guest-setup: bad group name: $DEV_GROUP" >&2; exit 2 ;;
  *) ;;
esac
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
# DEV_USER, DEV_GROUP and DEV_HOME (so DEV_ROOT) were checked above: only
# letters, digits, dot, underscore and dash (plus slashes in the path), so they
# are safe to write unquoted into this root-run script.
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
# every 400 ms by default; a full walk of the ui tree that often costs about
# 40% of a core. 2 s costs a short delay before Fast Refresh instead.
install -d -m 0755 /etc/systemd/system/turbopanel-ui.service.d
cat >/etc/systemd/system/turbopanel-ui.service.d/poll-interval.conf <<'EOF'
[Service]
# Written by scripts/incus-guest-setup.sh.
Environment=TURBOPANEL_METRO_POLL_MS=2000
EOF
systemctl daemon-reload

echo ">>> Metro heap 3 GiB (fits a 6 GiB VM; applies after: systemctl restart turbopanel-ui)"
# The unit sets NODE_OPTIONS with a 4 GiB old-space heap. A later assignment of
# the same variable wins, so a drop-in repeats the unit's options with 3072.
# 3072 is the floor: with less, Metro died with "Ineffective mark-compacts near
# heap limit" while bundling the console. Keep the options in step with
# turbopaneld's instance-launch turbopanel-ui.service.j2.
cat >/etc/systemd/system/turbopanel-ui.service.d/heap.conf <<'EOF'
[Service]
# Written by scripts/incus-guest-setup.sh.
Environment="NODE_OPTIONS=--dns-result-order=ipv4first --max-old-space-size=3072"
EOF
systemctl daemon-reload

echo ">>> The Expo dev server does not start at boot unless chosen"
# The UI is served as a static development build by default (Caddy serves the
# export; see docs/dev-environment.md), so turbopanel-ui (Metro) stays off at
# boot to keep a 4 GiB VM within memory. It stays startable by hand with
# sudo systemctl start turbopanel-ui, and the converge enables it again when the
# Expo Dev Server is chosen: TURBOPANEL_UI_MODE=dev in /etc/turbopanel/daemon.env
# (written by the console from the picker). That choice is kept here.
# Website and Drizzle Studio are on by default now and are left as the converge
# set them. Left on at boot too: turbopanel-tunnel-instance (the daemon enables,
# disables and supervises it, and the panel reaches the instance through it) and
# turbopanel-mailpit (instance email, including login mail, goes to its SMTP
# port).
UI_MODE=$(sed -n 's/^TURBOPANEL_UI_MODE=//p' /etc/turbopanel/daemon.env 2>/dev/null | tail -n 1)
if [ "$UI_MODE" != dev ] && systemctl cat turbopanel-ui.service >/dev/null 2>&1; then
  systemctl disable turbopanel-ui.service 2>&1
fi

echo ">>> Free page reporting returns 32 KiB blocks to the host"
cat >/etc/tmpfiles.d/turbopanel-page-reporting.conf <<'EOF'
# Written by scripts/incus-guest-setup.sh.
# Order 5 (32 KiB) so the balloon reports smaller free blocks to the host.
w- /sys/module/page_reporting/parameters/page_reporting_order - - - - 5
EOF
systemd-tmpfiles --create /etc/tmpfiles.d/turbopanel-page-reporting.conf || true

echo ">>> /tmp on disk"
# Debian mounts /tmp as tmpfs, so build and test copies would sit in RAM.
# Masking tmp.mount leaves /tmp on the root disk from the next reboot.
systemctl mask tmp.mount 2>&1

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

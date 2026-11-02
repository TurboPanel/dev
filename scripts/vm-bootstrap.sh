#!/bin/sh
# Prepare a plain Debian 13 machine (Proxmox VM, bare metal, any hypervisor
# without Vagrant) so a contributor can run ~/dev/console on it.
#
# Run as root, or through sudo. Safe to run again: every step checks first.
# Does only what the Vagrant guest setup does for the dev user; it never sets up
# the Vagrant-only shares, port forwards or login banner.
#
#   sudo sh scripts/vm-bootstrap.sh [options] [DEV_USER]
#
# DEV_USER defaults to TURBOPANEL_DEV_USER, then to the user who ran sudo. Any
# existing non-root account works; no name is assumed.
set -eu

DEV_USER=${TURBOPANEL_DEV_USER:-}
DO_UPGRADE=0
DO_CLONE=0
DO_SWAP=0
ALIASES=

tp_usage() {
  cat <<'USAGE'
Usage: vm-bootstrap.sh [options] [DEV_USER]

  --upgrade           apt upgrade before anything else
  --swap              create an 8 GiB /swapfile when the root disk has room
  --lan-alias NAME    extra DNS name this VM answers to (repeatable); written to
                      /etc/turbopanel/dev-forward-hosts
  --clone             clone dev, turbopaneld, turbopanel, ui, website and .github
                      into the dev user's home over SSH (skips existing folders)
  -h, --help          show this help
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --upgrade) DO_UPGRADE=1 ;;
    --swap) DO_SWAP=1 ;;
    --clone) DO_CLONE=1 ;;
    --lan-alias)
      [ "$#" -ge 2 ] || { tp_usage >&2; exit 2; }
      case "$2" in
        *[!A-Za-z0-9._-]* | [-.]* | '') printf 'vm-bootstrap: bad --lan-alias name: %s\n' "$2" >&2; exit 2 ;;
        *) ;;
      esac
      ALIASES="${ALIASES}${2}
"
      shift
      ;;
    -h | --help) tp_usage; exit 0 ;;
    -*) echo "vm-bootstrap: unknown option: $1" >&2; tp_usage >&2; exit 2 ;;
    *) DEV_USER=$1 ;;
  esac
  shift
done

[ -n "$DEV_USER" ] || DEV_USER=${SUDO_USER:-}
if [ -z "$DEV_USER" ] || [ "$DEV_USER" = root ]; then
  echo "vm-bootstrap: name the dev user (argument, TURBOPANEL_DEV_USER or sudo from that account)." >&2
  exit 1
fi
case "$DEV_USER" in
  *[!A-Za-z0-9._-]* | [0-9]*)
    printf 'vm-bootstrap: %s is not a plain user name.\n' "$DEV_USER" >&2
    exit 1
    ;;
  *) ;;
esac
if [ "$(id -u)" -ne 0 ]; then
  echo "vm-bootstrap: run as root or with sudo." >&2
  exit 1
fi

PASSWD_LINE=$(getent passwd "$DEV_USER" 2>/dev/null) || {
  printf 'vm-bootstrap: user %s does not exist; create it first (adduser %s).\n' "$DEV_USER" "$DEV_USER" >&2
  exit 1
}
DEV_USER=$(printf '%s\n' "$PASSWD_LINE" | cut -d: -f1)
DEV_HOME=$(printf '%s\n' "$PASSWD_LINE" | cut -d: -f6)

export DEBIAN_FRONTEND=noninteractive

echo ">>> Installing base packages"
apt-get -o DPkg::Lock::Timeout=300 update -qq
if [ "$DO_UPGRADE" -eq 1 ]; then
  apt-get -o DPkg::Lock::Timeout=300 -y \
    -o Dpkg::Options::="--force-confdef" \
    -o Dpkg::Options::="--force-confold" \
    upgrade
  apt-get -o DPkg::Lock::Timeout=300 -y autoremove
fi
# sudo first: a minimal Debian install may not ship it. tar and coreutils
# (sha256sum) are what ./console checks for before it vendors Node.
apt-get -o DPkg::Lock::Timeout=300 install -y sudo curl git ca-certificates openssh-client tar

echo ">>> Giving ${DEV_USER} sudo access"
# ./console requires membership in the sudo group; the drop-in below adds the
# passwordless rule it needs on top.
if ! id -nG "$DEV_USER" | tr ' ' '\n' | grep -qx sudo; then
  usermod -aG sudo "$DEV_USER"
fi
# One file per user so a second user never replaces the first user's rule. The
# file is named after the numeric uid, which is unique, so names such as bob.smith
# and bob_smith cannot collide (sudo also ignores names with a dot in them).
DEV_UID=$(printf '%s\n' "$PASSWD_LINE" | cut -d: -f3)
SUDOERS=/etc/sudoers.d/turbopanel-dev-nopasswd-uid${DEV_UID}
# Do not touch anything while the sudoers tree is already broken; that is not ours.
if ! CHECK_OUT=$(visudo -c 2>&1); then
  printf 'vm-bootstrap: the existing sudoers configuration is already invalid; nothing was changed.\n%s\n' "$CHECK_OUT" >&2
  exit 1
fi
TMP=$(mktemp)
BACKUP=$(mktemp)
cat >"$TMP" <<EOT
# TurboPanel development passwordless sudo for ${DEV_USER} (uid ${DEV_UID})
# Installed by dev/scripts/vm-bootstrap.sh; remove this file to revert.
${DEV_USER} ALL=(ALL) NOPASSWD: ALL
EOT
if ! visudo -c -f "$TMP" >/dev/null; then
  rm -f "$TMP" "$BACKUP"
  echo "vm-bootstrap: generated sudoers rule failed visudo -c." >&2
  exit 1
fi
if ! cmp -s "$TMP" "$SUDOERS" 2>/dev/null; then
  HAD_RULE=0
  if [ -f "$SUDOERS" ]; then
    HAD_RULE=1
    cp -p "$SUDOERS" "$BACKUP"
  fi
  install -m 0440 -o root -g root "$TMP" "$SUDOERS"
  if ! visudo -c >/dev/null 2>&1; then
    if [ "$HAD_RULE" -eq 1 ]; then
      install -m 0440 -o root -g root "$BACKUP" "$SUDOERS"
      echo "vm-bootstrap: the new rule broke the sudoers check; restored the previous ${SUDOERS}." >&2
    else
      rm -f "$SUDOERS"
      echo "vm-bootstrap: the new rule broke the sudoers check; removed ${SUDOERS}." >&2
    fi
    rm -f "$TMP" "$BACKUP"
    exit 1
  fi
fi
rm -f "$TMP" "$BACKUP"

echo ">>> Writing /etc/profile.d/turbopanel-dev.sh"
cat >/etc/profile.d/turbopanel-dev.sh <<'EOT'
# TurboPanel development host defaults (sourced for login shells).
# ./console also exports TURBOPANEL_MODE=development and repo paths under $HOME.
export TURBOPANEL_MODE="${TURBOPANEL_MODE:-development}"
EOT
chmod 644 /etc/profile.d/turbopanel-dev.sh

if [ "$DO_SWAP" -eq 1 ]; then
  SWAPFILE=/swapfile
  SWAP_BYTES=$((8 * 1024 * 1024 * 1024))
  ROOT_RESERVE=$((12 * 1024 * 1024 * 1024))
  if grep -q "^${SWAPFILE}[[:space:]]" /proc/swaps 2>/dev/null; then
    echo ">>> Swap file already active"
  else
    ROOT_AVAIL=$(df -B1 --output=avail / | tail -n 1 | tr -d ' ')
    if [ "$ROOT_AVAIL" -lt $((SWAP_BYTES + ROOT_RESERVE)) ]; then
      echo "Skipping swap file: root has ${ROOT_AVAIL} bytes free (need ${SWAP_BYTES}+${ROOT_RESERVE})." >&2
    else
      echo ">>> Creating 8 GiB swap file"
      rm -f "$SWAPFILE"
      fallocate -l "$SWAP_BYTES" "$SWAPFILE" 2>/dev/null ||
        dd if=/dev/zero of="$SWAPFILE" bs=1M count=8192 status=none
      chmod 600 "$SWAPFILE"
      mkswap "$SWAPFILE" >/dev/null
      swapon "$SWAPFILE"
      grep -q "^${SWAPFILE}[[:space:]]" /etc/fstab ||
        printf '%s none swap sw 0 0\n' "$SWAPFILE" >>/etc/fstab
    fi
  fi
fi

if [ -n "$ALIASES" ]; then
  echo ">>> Writing /etc/turbopanel/dev-forward-hosts"
  # Keep an existing /etc/turbopanel as it is; only create it when missing.
  # The aliases file is world-readable (names only) so every dev user can read it.
  [ -d /etc/turbopanel ] || install -d -m 0755 /etc/turbopanel
  HOSTS=/etc/turbopanel/dev-forward-hosts
  {
    [ ! -f "$HOSTS" ] || cat "$HOSTS"
    printf '%s' "$ALIASES"
  } | sort -u >"${HOSTS}.new"
  chmod 0644 "${HOSTS}.new"
  mv "${HOSTS}.new" "$HOSTS"
fi

if [ "$DO_CLONE" -eq 1 ]; then
  echo ">>> Cloning sibling repos into ${DEV_HOME}"
  # sudo drops SSH_AUTH_SOCK unless kept; pass it on when present so a forwarded
  # key (ssh -A) can fetch from GitHub.
  for repo in dev turbopaneld turbopanel ui website .github; do
    if [ -e "${DEV_HOME}/${repo}" ]; then
      echo "    ${repo}: ${DEV_HOME}/${repo} already exists, skipping"
      continue
    fi
    runuser -u "$DEV_USER" -- env "HOME=${DEV_HOME}" "SSH_AUTH_SOCK=${SSH_AUTH_SOCK:-}" \
      git clone "git@github.com:TurboPanel/${repo}.git" "${DEV_HOME}/${repo}"
  done
fi

NEEDS_REBOOT=0
[ ! -f /var/run/reboot-required ] || NEEDS_REBOOT=1
RUNNING_KERNEL=$(uname -r)
NEWEST_KERNEL=$(find /boot -maxdepth 1 -name 'vmlinuz-*' 2>/dev/null | sed 's|.*/vmlinuz-||' | sort -V | tail -n 1 || true)
if [ -n "$NEWEST_KERNEL" ] && [ "$RUNNING_KERNEL" != "$NEWEST_KERNEL" ]; then
  NEEDS_REBOOT=1
fi
if [ "$NEEDS_REBOOT" -eq 1 ]; then
  echo ">>> A reboot is pending (running ${RUNNING_KERNEL}, newest ${NEWEST_KERNEL:-unknown}); run 'sudo reboot' before continuing."
fi

cat <<EOT

Done. Next, as ${DEV_USER}:
  1. Log out and back in so the sudo group applies.
  2. Make sure the six repos sit in ${DEV_HOME} (rerun with --clone, or clone by hand).
  3. Run:  ${DEV_HOME}/dev/console
EOT

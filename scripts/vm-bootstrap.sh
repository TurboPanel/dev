#!/bin/sh
# Prepare a plain Debian 13 machine (Proxmox VM, bare metal, any hypervisor
# without Vagrant) so a contributor can run ~/turbopanel/dev/console on it.
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
                      over SSH into TURBOPANEL_DEV_ROOT, else ~/turbopanel
                      (skips existing folders)
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
  printf 'vm-bootstrap: user %s does not exist; create it first (useradd -m -s /bin/bash %s).\n' "$DEV_USER" "$DEV_USER" >&2
  exit 1
}
DEV_USER=$(printf '%s\n' "$PASSWD_LINE" | cut -d: -f1)
DEV_HOME=$(printf '%s\n' "$PASSWD_LINE" | cut -d: -f6)

DEV_UID=$(printf '%s\n' "$PASSWD_LINE" | cut -d: -f3)

# The folder that holds the repos: TURBOPANEL_DEV_ROOT (setup.sh passes it),
# else <home>/turbopanel. Same rules as tp_validate_dev_root in
# scripts/lib/paths.sh: the value is written unquoted into the profile file,
# env files, unit lines and Ansible vars, so only an absolute path of plain
# characters without . or .. parts is accepted, and it must be a folder named
# turbopanel (this script is never run in the Vagrant guest, the one place the
# repos sit directly in the home folder). Checked before anything changes.
DEV_ROOT=${TURBOPANEL_DEV_ROOT:-$DEV_HOME/turbopanel}
while [ "${#DEV_ROOT}" -gt 1 ] && [ "${DEV_ROOT%/}" != "$DEV_ROOT" ]; do
  DEV_ROOT=${DEV_ROOT%/}
done
case "$DEV_ROOT" in
  / | [!/]* | *[!A-Za-z0-9._@+/-]*)
    printf 'vm-bootstrap: TURBOPANEL_DEV_ROOT=%s must be an absolute path of letters, digits and . _ @ + - / only.\n' "$DEV_ROOT" >&2
    exit 1
    ;;
  *) ;;
esac
case "$DEV_ROOT/" in
  */./* | */../*)
    printf 'vm-bootstrap: TURBOPANEL_DEV_ROOT=%s must not contain . or .. segments.\n' "$DEV_ROOT" >&2
    exit 1
    ;;
  *) ;;
esac
if [ "${DEV_ROOT##*/}" != turbopanel ]; then
  printf 'vm-bootstrap: TURBOPANEL_DEV_ROOT=%s is not a folder named turbopanel; the repos belong in one, e.g. ~/turbopanel/<repo> (run dev/scripts/setup.sh to set it up).\n' "$DEV_ROOT" >&2
  exit 1
fi
# An older layout kept the repos directly in the home folder. Defaulting to
# ~/turbopanel then would clone (or point the console at) a second, empty set,
# so stop with the steps to move them instead. Only when no root was given.
if [ -z "${TURBOPANEL_DEV_ROOT:-}" ] && [ ! -e "${DEV_ROOT}/dev" ] &&
  { [ -f "${DEV_HOME}/dev/Vagrantfile" ] || [ -d "${DEV_HOME}/turbopaneld" ]; }; then
  printf 'vm-bootstrap: the repos sit in %s, which is not a folder named turbopanel; they belong in one, e.g. ~/turbopanel/<repo>.\n' "$DEV_HOME" >&2
  printf '  Stop the daemon first:  systemctl stop turbopaneld\n' >&2
  printf '  Move them, as %s:  cd %s && mkdir tp-move && for r in dev turbopaneld turbopanel ui website .github; do [ ! -e "$r" ] || mv "$r" tp-move/; done && mv tp-move turbopanel\n' "$DEV_USER" "$DEV_HOME" >&2
  printf '  Then run:  %s/turbopanel/dev/scripts/setup.sh\n' "$DEV_HOME" >&2
  exit 1
fi

if [ -e "${DEV_ROOT}/.git" ]; then
  printf 'vm-bootstrap: TURBOPANEL_DEV_ROOT=%s is a git checkout, not the folder that holds the repos (in the old home-folder layout ~/turbopanel is the control plane repo); move the repos into a new folder named turbopanel first.\n' "$DEV_ROOT" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

# Check the whole sudoers tree before anything else is changed, so a broken
# configuration stops the run with nothing touched. visudo ships with sudo; on a
# minimal image that has no sudo yet, installing it is the only step taken first.
if ! command -v visudo >/dev/null 2>&1; then
  echo ">>> visudo is missing; installing sudo first (the only change before the sudoers check)"
  apt-get -o DPkg::Lock::Timeout=300 update -qq
  apt-get -o DPkg::Lock::Timeout=300 install -y sudo
fi
if ! CHECK_OUT=$(visudo -c 2>&1); then
  printf 'vm-bootstrap: the existing sudoers configuration is already invalid; no users, groups or files were changed.\n%s\n' "$CHECK_OUT" >&2
  exit 1
fi

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
SUDOERS=/etc/sudoers.d/turbopanel-dev-nopasswd-uid${DEV_UID}
# sudo matches rules by name, so a rule file whose recorded user is gone, or now
# has another uid, would let a recreated account of that name inherit NOPASSWD.
# Remove our own stale files (never anyone else's).
for OLD in /etc/sudoers.d/turbopanel-dev-nopasswd-uid*; do
  [ -f "$OLD" ] || continue
  [ "$OLD" != "$SUDOERS" ] || continue
  OLD_USER=$(sed -n 's/^# TurboPanel development passwordless sudo for \([^ ]*\) (uid \([0-9]*\))$/\1/p' "$OLD")
  OLD_UID=$(sed -n 's/^# TurboPanel development passwordless sudo for \([^ ]*\) (uid \([0-9]*\))$/\2/p' "$OLD")
  [ -n "$OLD_USER" ] || continue
  if [ "$(getent passwd "$OLD_USER" | cut -d: -f3)" != "$OLD_UID" ]; then
    echo ">>> Removing stale sudo rule ${OLD} (${OLD_USER} with uid ${OLD_UID} no longer exists)"
    rm -f "$OLD"
  fi
done
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
# ./console also exports TURBOPANEL_MODE=development and repo paths under TURBOPANEL_DEV_ROOT (default $HOME/turbopanel).
export TURBOPANEL_MODE="${TURBOPANEL_MODE:-development}"
EOT
# Only for the dev user; DEV_ROOT and DEV_USER were checked above, so they are
# safe to write unquoted. An explicit TURBOPANEL_DEV_ROOT still wins.
cat >>/etc/profile.d/turbopanel-dev.sh <<EOT
# The repos live in ${DEV_ROOT} for ${DEV_USER} (written by vm-bootstrap.sh).
if [ "\$(id -un)" = "${DEV_USER}" ]; then
  export TURBOPANEL_DEV_ROOT="\${TURBOPANEL_DEV_ROOT:-${DEV_ROOT}}"
fi
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
  echo ">>> Cloning sibling repos into ${DEV_ROOT}"
  # Created as the dev user, so a folder that user cannot create stops here.
  if ! runuser -u "$DEV_USER" -- mkdir -p "$DEV_ROOT"; then
    printf 'vm-bootstrap: %s cannot create or use %s.\n' "$DEV_USER" "$DEV_ROOT" >&2
    exit 1
  fi
  # sudo drops SSH_AUTH_SOCK unless kept; pass it on when present so a forwarded
  # key (ssh -A) can fetch from GitHub. HOME stays the real home (SSH keys).
  for repo in dev turbopaneld turbopanel ui website .github; do
    if [ -e "${DEV_ROOT}/${repo}" ]; then
      echo "    ${repo}: ${DEV_ROOT}/${repo} already exists, skipping"
      continue
    fi
    runuser -u "$DEV_USER" -- env "HOME=${DEV_HOME}" "SSH_AUTH_SOCK=${SSH_AUTH_SOCK:-}" \
      git clone "git@github.com:TurboPanel/${repo}.git" "${DEV_ROOT}/${repo}"
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
  2. Make sure the six repos sit in ${DEV_ROOT} (rerun with --clone, or clone by hand).
  3. Run:  ${DEV_ROOT}/dev/console
EOT

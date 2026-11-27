#!/bin/sh
# Guest setup for a Lima dev VM whose repos are mounted from the macOS host
# (lima.yaml). Run as root inside the guest; lima.yaml runs it on every start:
#
#   sudo sh scripts/lima-guest-setup.sh [--force] DEV_USER
#
# The heavy steps (apt, vm-bootstrap.sh, incus-guest-setup.sh) run once: after
# they succeed the script writes /var/lib/turbopanel-dev/lima-guest-setup.done
# and later runs skip them, so a start needs no network and keeps the optional
# units the user picked. --force (or TURBOPANEL_LIMA_FORCE=1) removes that
# check and runs everything again. The cheap offline steps (host-path symlink,
# first-login password prompt, banner) run every time, and so does the one-time
# compressed RAM swap step for a guest set up without it. Every step checks first, so a rerun is safe. Does what the Incus guest setup
# does (vm-bootstrap.sh, then scripts/incus-guest-setup.sh for the guest-local
# pnpm store and node_modules, which a virtiofs share cannot host), without the
# port redirect, since Lima forwards guest ports to the host's 127.0.0.1 itself.
# It never runs setup.sh: that would rewrite the host's mode file with the
# guest's paths.
set -eu

FORCE=${TURBOPANEL_LIMA_FORCE:-0}
if [ "${1:-}" = --force ]; then
  FORCE=1
  shift
fi
DEV_USER=${1:-}
if [ -z "$DEV_USER" ] || [ "$DEV_USER" = root ]; then
  echo "lima-guest-setup: name the dev user." >&2
  exit 2
fi
case "$DEV_USER" in
  *[!A-Za-z0-9._-]* | -*) echo "lima-guest-setup: bad user name: $DEV_USER" >&2; exit 2 ;;
  *) ;;
esac
[ "$(id -u)" -eq 0 ] || { echo "lima-guest-setup: run as root." >&2; exit 1; }
DEV_HOME=$(getent passwd "$DEV_USER" | cut -d: -f6)
[ -n "$DEV_HOME" ] || { echo "lima-guest-setup: no such user: $DEV_USER" >&2; exit 1; }
case "$DEV_HOME" in
  /*) ;;
  *) echo "lima-guest-setup: home folder is not an absolute path: $DEV_HOME" >&2; exit 2 ;;
esac
case "$DEV_HOME" in
  *[!A-Za-z0-9._/-]* | *//* | */../* | */.. | */./* | */.)
    echo "lima-guest-setup: unsafe home folder: $DEV_HOME" >&2; exit 2 ;;
  *) ;;
esac
DEV_ROOT="${DEV_HOME}/turbopanel"
SCRIPTS="${DEV_ROOT}/dev/scripts"
[ -f "${SCRIPTS}/vm-bootstrap.sh" ] || {
  echo "lima-guest-setup: ${SCRIPTS}/vm-bootstrap.sh is missing; the host folder is not mounted at ${DEV_ROOT}." >&2
  exit 1
}

MARKER_DIR=/var/lib/turbopanel-dev
MARKER="${MARKER_DIR}/lima-guest-setup.done"
if [ "$FORCE" != 1 ] && [ -f "$MARKER" ]; then
  echo ">>> Base setup already done (${MARKER}); pass --force to run it again"
  # A guest set up before the compressed RAM swap existed gets it once, from the
  # swap step alone (offline, idempotent), without the heavy steps above.
  if [ ! -x /usr/local/sbin/tp-zram-swap ]; then
    echo ">>> Compressed RAM swap (zram) for an existing guest"
    TURBOPANEL_DEV_ROOT="$DEV_ROOT" sh "${SCRIPTS}/vm-bootstrap.sh" --swap "$DEV_USER"
  fi
else
  export DEBIAN_FRONTEND=noninteractive
  echo ">>> Packages the vendored Node and the dev tests need"
  # libatomic1 is also installed on demand by ./console; doing it here keeps the
  # first console run from needing a second apt step. jq is used by the dev tests.
  apt-get -o DPkg::Lock::Timeout=300 update -qq
  apt-get -o DPkg::Lock::Timeout=300 install -y -qq libatomic1 jq >/dev/null

  echo ">>> Base setup for ${DEV_USER}"
  TURBOPANEL_DEV_ROOT="$DEV_ROOT" sh "${SCRIPTS}/vm-bootstrap.sh" --swap "$DEV_USER"

  echo ">>> Shared-folder setup"
  sh "${SCRIPTS}/incus-guest-setup.sh" "$DEV_USER"
  install -d -m 0755 "$MARKER_DIR"
  date -u +%Y-%m-%dT%H:%M:%SZ >"$MARKER"
  chmod 0644 "$MARKER"
fi

echo ">>> Host path inside the VM"
# Git worktrees record the host's absolute path in their .git file; the same
# path inside the VM lets git (and the tests) work in worktrees. The host path
# is the mode file's dev_root, written by setup.sh on the host.
HOST_ROOT=$(sed -n "s/^dev_root='\(.*\)'\$/\1/p" "${DEV_ROOT}/.turbopanel-dev-mode" 2>/dev/null | tail -n 1)
case "$HOST_ROOT" in
  '' | "$DEV_ROOT") ;;
  /*)
    case "$HOST_ROOT" in
      *[!A-Za-z0-9._@+/-]* | *//* | */../* | */.. | */./* | */.) echo "skipped: unsafe host path" ;;
      *)
        if [ ! -e "$HOST_ROOT" ] && [ ! -L "$HOST_ROOT" ]; then
          # Root-owned parents: never re-own or re-mode a folder that exists.
          mkdir -p "$(dirname "$HOST_ROOT")"
          ln -s "$DEV_ROOT" "$HOST_ROOT"
        fi
        ;;
    esac
    ;;
  *) ;;
esac
# Asks the dev user to set a password on the first interactive login (the panel's
# first sign-in checks it through PAM); silent once one is set.
# Only for the dev user: DEV_USER was checked above, so it is safe to write into the file.
sed "s/@DEV_USER@/${DEV_USER}/g" "${SCRIPTS}/guest/dev-password.sh" >/etc/profile.d/turbopanel-dev-password.sh.tmp
chmod 0644 /etc/profile.d/turbopanel-dev-password.sh.tmp
mv -f /etc/profile.d/turbopanel-dev-password.sh.tmp /etc/profile.d/turbopanel-dev-password.sh
sh "${SCRIPTS}/guest/install-motd.sh" || true
echo ">>> Done"

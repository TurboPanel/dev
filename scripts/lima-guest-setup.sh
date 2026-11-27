#!/bin/sh
# Guest setup for a Lima dev VM whose repos are mounted from the macOS host
# (lima.yaml). Run as root inside the guest; lima.yaml runs it on the first boot:
#
#   sudo sh scripts/lima-guest-setup.sh DEV_USER
#
# Safe to run again: every step checks first. Does what the Incus guest setup
# does (vm-bootstrap.sh, then scripts/incus-guest-setup.sh for the guest-local
# pnpm store and node_modules, which a virtiofs share cannot host), without the
# port redirect, since Lima forwards guest ports to the host's 127.0.0.1 itself.
# It never runs setup.sh: that would rewrite the host's mode file with the
# guest's paths.
set -eu

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
sh "${SCRIPTS}/guest/install-motd.sh" || true
echo ">>> Done"

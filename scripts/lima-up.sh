#!/bin/sh
# Create (first run) or start (later runs) the TurboPanel Lima dev VM on a macOS
# host, then print how to get in. The repos stay on this machine and are
# mounted into the VM at ~/turbopanel; the VM only runs the stack.
#
#   ./scripts/lima-up.sh
#   TURBOPANEL_LIMA_MEMORY=8GiB TURBOPANEL_LIMA_CPUS=4 ./scripts/lima-up.sh
#
# Environment (sizes apply when the VM is created; change them later with
# limactl stop, limactl edit, limactl start):
#   TURBOPANEL_LIMA_NAME     instance name (default turbopanel-dev)
#   TURBOPANEL_LIMA_CPUS     CPUs (default 2)
#   TURBOPANEL_LIMA_MEMORY   memory in GiB, with or without the GiB suffix (default 4GiB)
#   TURBOPANEL_LIMA_DISK     disk in GiB, with or without the GiB suffix (default 64GiB)
# Delete the VM with: limactl delete -f NAME (the repos on this machine stay).
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DEV_ROOT=$(dirname "$REPO_ROOT")

tp_die() {
  echo "lima-up: $*" >&2
  exit 1
}

tp_gib() {
  _value=$1
  _label=$2
  _g=${_value%GiB}
  case "$_g" in
    '' | *[!0-9]* | 0*) tp_die "${_label} must be a whole number of GiB such as 4GiB, not ${_value}." ;;
    *) printf '%s' "$_g" ;;
  esac
}

NAME=${TURBOPANEL_LIMA_NAME:-turbopanel-dev}
case "$NAME" in
  '' | [!A-Za-z0-9]* | *[!A-Za-z0-9._-]*) tp_die "TURBOPANEL_LIMA_NAME must be letters, digits, '.', '_' and '-', starting with a letter or digit, not ${NAME}." ;;
  *) ;;
esac
CPUS=${TURBOPANEL_LIMA_CPUS:-2}
case "$CPUS" in
  '' | *[!0-9]* | 0*) tp_die "TURBOPANEL_LIMA_CPUS must be a positive whole number, not ${CPUS}." ;;
  *) ;;
esac
MEMORY=$(tp_gib "${TURBOPANEL_LIMA_MEMORY:-4GiB}" TURBOPANEL_LIMA_MEMORY)
DISK=$(tp_gib "${TURBOPANEL_LIMA_DISK:-64GiB}" TURBOPANEL_LIMA_DISK)

[ "$(uname -s)" = Darwin ] || tp_die "Lima mode is for macOS hosts."
command -v limactl >/dev/null 2>&1 || tp_die "limactl is not installed; run: brew install lima"
case "$DEV_ROOT" in
  *[!A-Za-z0-9._@+/\ -]*) tp_die "the folder ${DEV_ROOT} has characters outside letters, digits and . _ @ + - / and space; move the repos to a plainer path." ;;
  *) ;;
esac
[ -f "$DEV_ROOT/dev/package.json" ] || tp_die "${DEV_ROOT} does not look like the folder that holds the repos."

if limactl list -q 2>/dev/null | grep -qx "$NAME"; then
  echo "lima-up: the VM ${NAME} exists; starting it if it is stopped (sizes and mounts stay as created)."
  limactl start "$NAME"
else
  echo "lima-up: creating ${NAME} (${CPUS} CPUs, ${MEMORY}GiB memory, ${DISK}GiB disk); the first start downloads Debian 13 and installs the base packages."
  limactl start --tty=false --name="$NAME" --cpus="$CPUS" --memory="$MEMORY" --disk="$DISK" \
    --param "devRoot=${DEV_ROOT}" "$REPO_ROOT/lima.yaml"
fi

cat <<NEXT

Next:
  limactl shell ${NAME} -- sudo passwd $(id -un)   (the panel installer checks this password through PAM)
  limactl shell ${NAME}
  Then, inside the VM: ~/turbopanel/dev/console
NEXT

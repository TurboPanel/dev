#!/bin/sh
# Install the TurboPanel development VM MOTD (replaces Debian's default).
# Run as root from the guest-motd provisioner.

set -eu

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' "install-motd.sh must run as root" >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MOTD_SRC="${SCRIPT_DIR}/motd.sh"
MOTD_DST=/etc/motd.d/10-turbopanel
TP_MOTD_FRAGMENT="10-turbopanel"

tp_mask_motd_fragment() {
  _path=$1
  [ -e "$_path" ] || [ -L "$_path" ] || return 0
  _name=$(basename -- "$_path")
  [ "$_name" = "$TP_MOTD_FRAGMENT" ] && return 0
  ln -sfn /dev/null "/etc/motd.d/${_name}"
}

tp_disable_debian_motd() {
  if [ -d /etc/update-motd.d ]; then
    for _f in /etc/update-motd.d/*; do
      [ -f "$_f" ] || continue
      chmod a-x "$_f" 2>/dev/null || true
    done
  fi

  if [ -e /run/motd.dynamic ]; then
    : >/run/motd.dynamic
  fi

  if [ -L /etc/motd ]; then
    rm -f /etc/motd
  fi
  : >/etc/motd

  install -d -m 0755 /etc/motd.d
  for _f in /usr/lib/motd.d/* /etc/motd.d/*; do
    tp_mask_motd_fragment "$_f"
  done
}

tp_disable_debian_motd

# Never write through a /dev/null mask leftover from a prior fragment name.
if [ -L "$MOTD_DST" ]; then
  rm -f "$MOTD_DST"
fi

if [ -f "$MOTD_SRC" ] && [ -r "$MOTD_SRC" ]; then
  /bin/sh "$MOTD_SRC" >"$MOTD_DST"
else
  printf '%s\n' "TurboPanel development environment. Run: ~/dev/console" >"$MOTD_DST"
fi
chmod 0644 "$MOTD_DST"

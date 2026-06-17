#!/bin/sh
# Repair turbopanel-ui.service when node_modules/.bin/expo is missing.
# Uses expo/bin/cli via node (matches instance-launch turbopanel-ui.service.j2).
set -eu

. "$(dirname "$0")/lib/privileges.sh"
. "$(dirname "$0")/lib/paths.sh"

UNIT=/etc/systemd/system/turbopanel-ui.service
NODE="${TURBOPANEL_ROOT}/runtimes/node/current/bin/node"
CLI="${TURBOPANEL_PLATFORM}/ui/node_modules/expo/bin/cli"
PORT=8081

tp_ensure_privileges

if [ ! -x "$NODE" ]; then
  echo "error: node runtime missing at $NODE" >&2
  exit 1
fi

if [ ! -f "$CLI" ]; then
  echo "error: expo cli missing at $CLI — run pnpm install in platform/ui as turbopanel" >&2
  exit 1
fi

NEW_START="ExecStart=${NODE} ${CLI} start --web --port ${PORT}"
if grep -q '^ExecStart=.*expo/bin/cli' "$UNIT" 2>/dev/null; then
  echo "turbopanel-ui.service already uses expo/bin/cli"
else
  sed -i "s|^ExecStart=.*|${NEW_START}|" "$UNIT"
  echo "updated $UNIT"
fi

systemctl daemon-reload
systemctl restart turbopanel-ui
sleep 3
systemctl is-active turbopanel-ui
systemctl show turbopanel-ui --property=ActiveState,SubState,MainPID,ExecMainStatus,NRestarts --no-pager

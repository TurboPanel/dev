#!/bin/sh
# Install or repair turbopanel-website.service (Next.js docs on :19820).
# Matches instance-launch turbopanel-website.service.j2 for Workers co-located dev.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
# shellcheck source=scripts/lib/privileges.sh
. "$SCRIPT_DIR/lib/privileges.sh"
# shellcheck source=scripts/lib/paths.sh
. "$SCRIPT_DIR/lib/paths.sh"
# shellcheck source=scripts/lib/dev-identity.sh
. "$SCRIPT_DIR/lib/dev-identity.sh"

UNIT=/etc/systemd/system/turbopanel-website.service
NODE="${TURBOPANEL_ROOT}/runtimes/node/current/bin/node"
NEXT="${TURBOPANEL_PLATFORM}/website/node_modules/next/dist/bin/next"
WEBSITE_DIR="${TURBOPANEL_PLATFORM}/website"
WEBSITE_LOCAL="${WEBSITE_DIR}/.local"
WEBSITE_CONFIG="${WEBSITE_DIR}/.config"
NORMALIZER=/usr/local/bin/turbopanel-normalize-dev-checkout
PORT=19820
CADDY_PORT=8443

tp_ensure_privileges /etc/systemd/system

tp_resolve_dev_identity || true

if [ ! -x "$NODE" ]; then
  echo "error: node runtime missing at $NODE" >&2
  exit 1
fi

if [ ! -f "$NEXT" ]; then
  echo "error: next binary missing at $NEXT — run pnpm install in platform/website as turbopanel" >&2
  exit 1
fi

if [ -x "$NORMALIZER" ]; then
  TURBOPANEL_DEV_USER="${TP_DEV_USER:-}" \
  TURBOPANEL_DEV_UID="${TP_DEV_UID:-}" \
  TURBOPANEL_DEV_GID="${TP_DEV_GID:-}" \
    "$NORMALIZER" "$WEBSITE_DIR" --force
  TURBOPANEL_DEV_USER="${TP_DEV_USER:-}" \
  TURBOPANEL_DEV_UID="${TP_DEV_UID:-}" \
  TURBOPANEL_DEV_GID="${TP_DEV_GID:-}" \
    "$NORMALIZER" "$WEBSITE_DIR" --ensure-runtime-dirs
else
  chown turbopanel:turbopanel "$WEBSITE_DIR"
  chmod 2770 "$WEBSITE_DIR"
  if command -v setfacl >/dev/null 2>&1; then
    setfacl -m g:turbopanel:rwx "$WEBSITE_DIR"
    setfacl -d -m g:turbopanel:rwx "$WEBSITE_DIR"
    if [ -n "${TP_DEV_USER:-}" ]; then
      setfacl -m "u:${TP_DEV_USER}:rwx" "$WEBSITE_DIR"
      setfacl -d -m "u:${TP_DEV_USER}:rwx" "$WEBSITE_DIR"
    fi
  fi
fi

install -d -o instance -g turbopanel -m 2770 "$WEBSITE_LOCAL" "$WEBSITE_LOCAL/share" "$WEBSITE_LOCAL/state" "$WEBSITE_CONFIG"

cat >"$UNIT" <<EOF
[Unit]
Description=TurboPanel website (Next.js docs dev server)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=instance
Group=turbopanel
WorkingDirectory=${WEBSITE_DIR}
Environment=HOME=${WEBSITE_LOCAL}
Environment=XDG_DATA_HOME=${WEBSITE_LOCAL}/share
Environment=XDG_STATE_HOME=${WEBSITE_LOCAL}/state
Environment=XDG_CONFIG_HOME=${WEBSITE_CONFIG}
Environment=PATH=/usr/local/bin:${TURBOPANEL_ROOT}/runtimes/node/current/bin:/usr/bin:/bin
Environment=WEBSITE_PORT=${PORT}
Environment=NEXT_PUBLIC_WEBSITE_PORT=${PORT}
Environment=CADDY_PORT=${CADDY_PORT}
Environment=NEXT_PUBLIC_CADDY_PORT=${CADDY_PORT}
Environment=COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ExecStart=${NODE} ${NEXT} dev --port ${PORT}
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

chmod 644 "$UNIT"
echo "installed $UNIT"

systemctl daemon-reload
systemctl enable turbopanel-website
systemctl reset-failed turbopanel-website 2>/dev/null || true
systemctl restart turbopanel-website
sleep 6
systemctl is-active turbopanel-website
systemctl show turbopanel-website --property=ActiveState,SubState,MainPID,ExecMainStatus,NRestarts --no-pager
curl -s -o /dev/null -w "HTTP %{http_code} http://127.0.0.1:${PORT}/\n" "http://127.0.0.1:${PORT}/" || true

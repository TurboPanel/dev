#!/bin/sh
# Install the co-located dev instance stack via a single Ansible converge playbook.
# Mirrors the daemon's runInstanceDevInstall() path so Start dev stack is synchronous.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
# shellcheck source=scripts/lib/privileges.sh
. "$SCRIPT_DIR/lib/privileges.sh"
# shellcheck source=scripts/lib/paths.sh
. "$SCRIPT_DIR/lib/paths.sh"
# shellcheck source=scripts/lib/dev-identity.sh
. "$SCRIPT_DIR/lib/dev-identity.sh"

DAEMON_DIR="$TURBOPANEL_PLATFORM/daemon"
ORCHESTRATION_DIR="$DAEMON_DIR/orchestration"
ANSIBLE_PLAYBOOK="$ORCHESTRATION_DIR/runtime/venv/bin/ansible-playbook"
ANSIBLE_CFG="$ORCHESTRATION_DIR/ansible.cfg"
INSTANCE_PLAYBOOK="$ORCHESTRATION_DIR/playbooks/instance-dev-install.yml"
ENV_FILE="$DAEMON_DIR/.env"

sh "$SCRIPT_DIR/ensure-orchestration-runtime.sh"

read_env_var() {
  _rev_key=$1
  _rev_default=${2:-}
  _rev_line=
  if [ -r "$ENV_FILE" ]; then
    _rev_line=$(grep "^${_rev_key}=" "$ENV_FILE" 2>/dev/null | tail -1 || true)
  elif command -v sudo >/dev/null 2>&1; then
    _rev_line=$(sudo grep "^${_rev_key}=" "$ENV_FILE" 2>/dev/null | tail -1 || true)
  fi
  if [ -n "$_rev_line" ]; then
    printf '%s' "${_rev_line#*=}"
    return 0
  fi
  printf '%s' "$_rev_default"
}

run_playbook() {
  _rp_playbook=$1
  shift

  if [ ! -x "$ANSIBLE_PLAYBOOK" ]; then
    tp_error "ansible-playbook not found — run bootstrap first"
    exit 1
  fi

  tp_info "Running $(basename "$_rp_playbook")..."

  if getent passwd turbopanel >/dev/null 2>&1; then
    sudo -u turbopanel env \
      HOME="$TURBOPANEL_ROOT" \
      ANSIBLE_CONFIG="$ANSIBLE_CFG" \
      "$ANSIBLE_PLAYBOOK" \
      -i localhost, \
      -c local \
      "$@" \
      "$_rp_playbook"
    return $?
  fi

  sudo env ANSIBLE_CONFIG="$ANSIBLE_CFG" \
    "$ANSIBLE_PLAYBOOK" \
    -i localhost, \
    -c local \
    "$@" \
    "$_rp_playbook"
}

tp_require_dev_identity

_env_user=$(read_env_var TURBOPANEL_DEV_USER "")
if [ -n "$_env_user" ] && [ "$_env_user" != "$TP_DEV_USER" ]; then
  tp_error "TURBOPANEL_DEV_USER in daemon .env ($_env_user) does not match session ($TP_DEV_USER)"
  exit 1
fi
_env_uid=$(read_env_var TURBOPANEL_DEV_UID "")
if [ -n "$_env_uid" ] && [ "$_env_uid" != "$TP_DEV_UID" ]; then
  tp_error "TURBOPANEL_DEV_UID in daemon .env ($_env_uid) does not match session ($TP_DEV_UID)"
  exit 1
fi
_env_gid=$(read_env_var TURBOPANEL_DEV_GID "")
if [ -n "$_env_gid" ] && [ "$_env_gid" != "$TP_DEV_GID" ]; then
  tp_error "TURBOPANEL_DEV_GID in daemon .env ($_env_gid) does not match session ($TP_DEV_GID)"
  exit 1
fi

DEV_USER=$TP_DEV_USER
DEV_UID=$TP_DEV_UID
DEV_GID=$TP_DEV_GID
UI_MODE=$(read_env_var TURBOPANEL_UI_MODE dev)
INSTANCE_RUN_MODE=$(read_env_var TURBOPANEL_INSTANCE_RUN_MODE source)
INSTANCE_RUNTIME=$(read_env_var TURBOPANEL_INSTANCE_RUNTIME deno)
if [ "$INSTANCE_RUNTIME" = "workers" ]; then
  POSTGRES_EXPOSE=true
else
  POSTGRES_EXPOSE=false
fi

EXTRA_VARS="
-e turbopanel_dev_user=${DEV_USER}
-e turbopanel_dev_uid=${DEV_UID}
-e turbopanel_dev_gid=${DEV_GID}
-e turbopanel_ui_mode=${UI_MODE}
-e turbopanel_instance_run_mode=${INSTANCE_RUN_MODE}
-e turbopanel_instance_runtime=${INSTANCE_RUNTIME}
-e postgres_expose_port=${POSTGRES_EXPOSE}
"

# shellcheck disable=SC2086
run_playbook "$INSTANCE_PLAYBOOK" $EXTRA_VARS

tp_success "Instance dev stack installed"

#!/bin/sh
# Reclaim orchestration/runtime for turbopanel (uv cache, ansible-tmp).
# Dev-user bootstrap or prior root/ansible runs can leave dev/root-owned files.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
# shellcheck source=scripts/lib/privileges.sh
. "$SCRIPT_DIR/lib/privileges.sh"
# shellcheck source=scripts/lib/paths.sh
. "$SCRIPT_DIR/lib/paths.sh"

ORCHESTRATION_RUNTIME="$TURBOPANEL_PLATFORM/daemon/orchestration/runtime"
ANSIBLE_TMP="$ORCHESTRATION_RUNTIME/cache/ansible-tmp"

tp_sudo() {
  if sudo -n true 2>/dev/null; then
    sudo "$@"
    return $?
  fi
  sudo "$@"
}

ensure_orchestration_runtime() {
  tp_info "Ensuring orchestration runtime is owned by turbopanel"
  tp_sudo mkdir -p "$ANSIBLE_TMP"
  if getent passwd turbopanel >/dev/null 2>&1; then
    # Use bash -c — dev console sudoers allow NOPASSWD bash, not chown directly.
    _quoted_runtime=$(printf '%s' "$ORCHESTRATION_RUNTIME" | sed "s/'/'\\\\''/g")
    tp_sudo bash -c "chown -R turbopanel:turbopanel '${_quoted_runtime}'"
  fi
}

ensure_orchestration_runtime

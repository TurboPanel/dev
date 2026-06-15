# Co-located dev host access for the turbopanel-dev console.
# Idempotent: group membership, user ACLs, Deno runtime access, passwordless
# sudo for console-driven turbopanel operations (current session + future runs).
# Source after privileges.sh and paths.sh; runtime.sh optional for Deno fix.

_tp_dha_lib_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
if [ ! -f "$_tp_dha_lib_dir/dev-identity.sh" ] && [ -n "${SCRIPT_DIR:-}" ]; then
  if [ -f "$SCRIPT_DIR/scripts/lib/dev-identity.sh" ]; then
    _tp_dha_lib_dir=$SCRIPT_DIR/scripts/lib
  elif [ -f "$SCRIPT_DIR/lib/dev-identity.sh" ]; then
    _tp_dha_lib_dir=$SCRIPT_DIR/lib
  fi
fi
# shellcheck source=scripts/lib/dev-identity.sh
. "$_tp_dha_lib_dir/dev-identity.sh"

TURBOPANEL_GROUP=turbopanel
TURBOPANEL_DEV_SUDOERS=/etc/sudoers.d/turbopanel-dev-console
RUNTIME_SOCKET_DIR=/run/turbopanel

tp_path_exists() {
  _pe_path=$1
  [ -e "$_pe_path" ] && return 0
  command -v sudo >/dev/null 2>&1 && sudo test -e "$_pe_path" 2>/dev/null
}

tp_sudo() {
  if sudo -n true 2>/dev/null; then
    sudo "$@"
    return $?
  fi
  sudo "$@"
}

tp_dev_in_turbopanel_group() {
  _ditg_user=$1
  [ -n "$_ditg_user" ] || return 1
  id -nG "$_ditg_user" 2>/dev/null | tr ' ' '\n' | grep -qx "$TURBOPANEL_GROUP"
}

tp_install_dev_console_sudoers() {
  _ids_user=$TP_DEV_USER
  [ -n "$_ids_user" ] || return 1

  _ids_tmp=$(mktemp)
  # shellcheck disable=SC2016
  cat >"$_ids_tmp" <<EOF
# Managed by turbopanel-dev (scripts/lib/dev-host-access.sh). Co-located dev only.
${_ids_user} ALL=(turbopanel) NOPASSWD: ALL
${_ids_user} ALL=(root) NOPASSWD: /bin/bash, /usr/bin/bash, /usr/bin/env
${_ids_user} ALL=(root) NOPASSWD: /usr/bin/setfacl, /bin/chmod, /usr/bin/chmod
${_ids_user} ALL=(root) NOPASSWD: /usr/sbin/usermod
${_ids_user} ALL=(root) NOPASSWD: /usr/bin/tee, /usr/bin/cp, /usr/bin/cat, /usr/bin/test
${_ids_user} ALL=(root) NOPASSWD: /usr/bin/mkdir, /bin/mkdir
${_ids_user} ALL=(root) NOPASSWD: /opt/turbopanel/runtimes/deno/v*/bin/deno
${_ids_user} ALL=(root) NOPASSWD: /usr/bin/systemctl, /bin/systemctl
EOF

  if [ -f "$TURBOPANEL_DEV_SUDOERS" ] && cmp -s "$_ids_tmp" "$TURBOPANEL_DEV_SUDOERS" 2>/dev/null; then
    rm -f "$_ids_tmp"
    return 0
  fi

  if ! tp_sudo visudo -cf "$_ids_tmp" >/dev/null 2>&1; then
    rm -f "$_ids_tmp"
    tp_warn "Could not validate turbopanel dev sudoers fragment"
    return 1
  fi

  tp_sudo install -m 0440 "$_ids_tmp" "$TURBOPANEL_DEV_SUDOERS"
  rm -f "$_ids_tmp"
}

tp_apply_dev_host_acls() {
  _ada_user=$TP_DEV_USER
  [ -n "$_ada_user" ] || return 1

  if ! command -v setfacl >/dev/null 2>&1; then
    tp_sudo chmod o+x "$TURBOPANEL_ROOT" 2>/dev/null || true
    tp_sudo chmod -R o+rx "$TURBOPANEL_RUNTIME" 2>/dev/null || true
    return 0
  fi

  _ada_apply() {
    _ada_path=$1
    _ada_mode=$2
    tp_path_exists "$_ada_path" || return 0
    tp_sudo setfacl -m "u:${_ada_user}:${_ada_mode}" "$_ada_path" 2>/dev/null || true
    if tp_sudo test -d "$_ada_path" 2>/dev/null; then
      tp_sudo setfacl -d -m "u:${_ada_user}:${_ada_mode}" "$_ada_path" 2>/dev/null || true
    fi
  }

  _ada_apply "$TURBOPANEL_ROOT" rx
  _ada_apply "$TURBOPANEL_RUNTIME" rx
  _ada_apply "$RUNTIME_SOCKET_DIR" rwx

  for _ada_checkout in \
    "$TURBOPANEL_PLATFORM" \
    "$TURBOPANEL_PLATFORM/daemon" \
    "$TURBOPANEL_PLATFORM/instance" \
    "$TURBOPANEL_PLATFORM/ui"; do
    tp_path_exists "$_ada_checkout" || continue
    tp_sudo setfacl -R -m "u:${_ada_user}:rwx" "$_ada_checkout" 2>/dev/null || true
    tp_sudo setfacl -R -d -m "u:${_ada_user}:rwx" "$_ada_checkout" 2>/dev/null || true
  done
}

tp_ensure_git_safe_directories() {
  _egsd_user=$TP_DEV_USER
  [ -n "$_egsd_user" ] || return 1
  command -v git >/dev/null 2>&1 || return 0

  for _egsd_repo in \
    "$TURBOPANEL_PLATFORM/daemon" \
    "$TURBOPANEL_PLATFORM/instance" \
    "$TURBOPANEL_PLATFORM/ui"; do
    tp_path_exists "$_egsd_repo/.git" || continue
    git config --global --get-all safe.directory 2>/dev/null \
      | grep -Fx "$_egsd_repo" >/dev/null 2>&1 && continue
    git config --global --add safe.directory "$_egsd_repo" 2>/dev/null || true
  done
}

tp_ensure_dev_host_access() {
  if ! tp_resolve_dev_identity; then
    tp_error "Cannot resolve developer identity from session (refusing spoofable USER/LOGNAME)"
    return 1
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    tp_warn "sudo is required for co-located dev access setup"
    return 1
  fi

  # One interactive sudo prompt when needed; later steps use NOPASSWD rules.
  tp_sudo true

  if getent group "$TURBOPANEL_GROUP" >/dev/null 2>&1; then
    if ! tp_dev_in_turbopanel_group "$TP_DEV_USER"; then
      tp_info "Adding ${TP_DEV_USER} to ${TURBOPANEL_GROUP} group"
      tp_sudo usermod -aG "$TURBOPANEL_GROUP" "$TP_DEV_USER"
    fi
  fi

  tp_install_dev_console_sudoers
  tp_apply_dev_host_acls
  tp_ensure_git_safe_directories

  if command -v tp_fix_deno_runtime_access >/dev/null 2>&1; then
    tp_fix_deno_runtime_access || true
  fi
}

case $(basename "$0") in
  dev-host-access.sh)
    # shellcheck source=scripts/lib/privileges.sh
    . "$(CDPATH= cd -- "$(dirname "$0")" && pwd)/privileges.sh"
    tp_ensure_dev_host_access
    ;;
esac

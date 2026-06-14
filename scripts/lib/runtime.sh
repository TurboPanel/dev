# Install the pinned Deno runtime under /opt/turbopanel/runtime.
# Bump DENO_VERSION in paths.sh (and src/paths.ts); ./console installs or
# upgrades on the next run and removes older version directories.
# Source after privileges.sh, paths.sh, and packages.sh.

tp_deno_runtime_usable() {
  [ -x "$DENO_BIN" ]
}

tp_deno_runtime_present() {
  if tp_deno_runtime_usable; then
    return 0
  fi
  if [ "$(id -u)" -eq 0 ]; then
    [ -x "$DENO_BIN" ]
    return $?
  fi
  command -v sudo >/dev/null 2>&1 && sudo test -x "$DENO_BIN" 2>/dev/null
}

# After Ansible creates turbopanel:turbopanel (750) under /opt/turbopanel, the
# invoking developer still needs to execute the console-owned Deno binary.
tp_fix_deno_runtime_access() {
  _dev_user=${USER:-}
  if [ -z "$_dev_user" ] || [ "$_dev_user" = "root" ]; then
    return 0
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    return 1
  fi
  if ! sudo test -x "$DENO_BIN" 2>/dev/null; then
    return 1
  fi

  # Traverse /opt/turbopanel without granting list access; open runtime for read+execute.
  sudo chmod o+x "$TURBOPANEL_ROOT" 2>/dev/null || true
  sudo chmod -R o+rx "$DENO_RUNTIME_ROOT" 2>/dev/null || true

  if command -v setfacl >/dev/null 2>&1; then
    sudo setfacl -m "u:${_dev_user}:rx" "$TURBOPANEL_ROOT" 2>/dev/null || true
    sudo setfacl -R -m "u:${_dev_user}:rx" "$DENO_RUNTIME_ROOT" 2>/dev/null || true
    sudo setfacl -R -d -m "u:${_dev_user}:rx" "$DENO_RUNTIME_ROOT" 2>/dev/null || true
  fi

  tp_deno_runtime_usable
}

tp_install_deno_runtime_body() {
  mkdir -p "$DENO_VERSION_DIR"
  DENO_INSTALL="$DENO_VERSION_DIR" \
    curl -fsSL https://deno.land/install.sh | sh -s "v${DENO_VERSION}" -- -y --no-modify-path
}

tp_remove_path() {
  _rp_path=$1
  if [ "$(id -u)" -eq 0 ] || tp_can_write_path "$_rp_path"; then
    rm -rf "$_rp_path"
    return 0
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    tp_warn "Could not remove ${_rp_path} — sudo is not available."
    return 1
  fi
  sudo rm -rf "$_rp_path"
}

tp_cleanup_old_deno_runtimes() {
  _old_dir=
  if [ ! -d "$DENO_RUNTIME_ROOT" ]; then
    return 0
  fi
  for _old_dir in "$DENO_RUNTIME_ROOT"/v*; do
    [ -d "$_old_dir" ] || continue
    [ "$_old_dir" = "$DENO_VERSION_DIR" ] && continue
    _old_ver=${_old_dir##*/v}
    tp_info "Removing outdated Deno v${_old_ver}"
    tp_remove_path "$_old_dir" || tp_warn "Could not remove ${_old_dir}"
  done
}

tp_other_deno_versions_present() {
  _old_dir=
  if [ ! -d "$DENO_RUNTIME_ROOT" ]; then
    return 1
  fi
  for _old_dir in "$DENO_RUNTIME_ROOT"/v*; do
    [ -d "$_old_dir" ] || continue
    [ "$_old_dir" = "$DENO_VERSION_DIR" ] && continue
    return 0
  done
  return 1
}

tp_install_deno_runtime() {
  if tp_deno_runtime_usable; then
    tp_cleanup_old_deno_runtimes
    return 0
  fi

  if tp_deno_runtime_present && tp_fix_deno_runtime_access; then
    tp_cleanup_old_deno_runtimes
    return 0
  fi

  _upgrading=0
  if tp_other_deno_versions_present; then
    _upgrading=1
  fi

  tp_ensure_deno_prerequisites

  if [ "$_upgrading" -eq 1 ]; then
    tp_info "Upgrading Deno to v${DENO_VERSION}"
  else
    tp_info "Installing Deno v${DENO_VERSION} to ${DENO_VERSION_DIR}"
  fi

  if [ "$(id -u)" -eq 0 ] || tp_can_write_path "$TURBOPANEL_ROOT"; then
    tp_install_deno_runtime_body
  else
    if ! command -v sudo >/dev/null 2>&1; then
      tp_error "Write access to ${TURBOPANEL_ROOT} requires root privileges, but sudo is not installed."
      exit 1
    fi
    tp_info "Administrator privileges required for ${TURBOPANEL_ROOT}"
    sudo mkdir -p "$DENO_VERSION_DIR"
    sudo env DENO_INSTALL="$DENO_VERSION_DIR" sh -c \
      "curl -fsSL https://deno.land/install.sh | sh -s v${DENO_VERSION} -- -y --no-modify-path"
    tp_fix_deno_runtime_access || true
  fi

  if ! tp_deno_runtime_usable; then
    tp_fix_deno_runtime_access || true
  fi

  if ! tp_deno_runtime_usable; then
    tp_error "Deno install failed — expected ${DENO_BIN}"
    exit 1
  fi

  if [ "$_upgrading" -eq 1 ]; then
    tp_success "Deno upgraded to v${DENO_VERSION}"
  else
    tp_success "Deno v${DENO_VERSION} installed"
  fi

  tp_cleanup_old_deno_runtimes
}

tp_ensure_deno_runtime() {
  tp_install_deno_runtime
}

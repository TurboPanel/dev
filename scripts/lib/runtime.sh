# Install the pinned Deno runtime under /opt/turbopanel/runtime.
# Bump DENO_VERSION in paths.sh (and src/paths.ts); ./console installs or
# upgrades on the next run and removes older version directories.
# Source after privileges.sh, paths.sh, and packages.sh.

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
  if [ -x "$DENO_BIN" ]; then
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
  fi

  if [ ! -x "$DENO_BIN" ]; then
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

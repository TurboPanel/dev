# Install the pinned Deno release to /usr/local/bin (GitHub release zip).
# Bump DENO_VERSION in paths.sh (and src/paths.ts); ./console installs or
# upgrades on the next run.
# Source after privileges.sh, paths.sh, and packages.sh.

tp_deno_linux_asset() {
  case $(uname -m) in
    aarch64|arm64) printf '%s' 'aarch64-unknown-linux-gnu' ;;
    x86_64|amd64) printf '%s' 'x86_64-unknown-linux-gnu' ;;
    *)
      tp_error "Unsupported Linux architecture for Deno: $(uname -m)"
      exit 1
      ;;
  esac
}

tp_deno_installed_version() {
  [ -x "$DENO_BIN" ] || return 1
  "$DENO_BIN" --version 2>/dev/null | head -1 | awk '{print $2}'
}

tp_deno_runtime_usable() {
  _tdu_version=$(tp_deno_installed_version) || return 1
  [ "$_tdu_version" = "$DENO_VERSION" ]
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

tp_cleanup_legacy_deno_runtime() {
  if [ ! -d "$DENO_LEGACY_RUNTIME_ROOT" ]; then
    return 0
  fi
  tp_info "Removing legacy Deno runtime at ${DENO_LEGACY_RUNTIME_ROOT}"
  tp_remove_path "$DENO_LEGACY_RUNTIME_ROOT" || tp_warn "Could not remove ${DENO_LEGACY_RUNTIME_ROOT}"
}

tp_install_deno_binary() {
  _idb_src=$1
  if [ "$(id -u)" -eq 0 ]; then
    install -m 755 "$_idb_src" "$DENO_BIN"
    return 0
  fi
  if tp_can_write_path "$DENO_BIN" 2>/dev/null || tp_can_write_path "$(dirname "$DENO_BIN")"; then
    install -m 755 "$_idb_src" "$DENO_BIN"
    return 0
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    tp_error "Installing Deno to ${DENO_BIN} requires root privileges, but sudo is not installed."
    exit 1
  fi
  tp_info "Administrator privileges required to install Deno to ${DENO_BIN}"
  sudo install -m 755 "$_idb_src" "$DENO_BIN"
}

tp_download_deno_release() {
  _ddr_asset=$(tp_deno_linux_asset)
  _ddr_zip_name=deno-${_ddr_asset}.zip
  _ddr_version_tag=v${DENO_VERSION}
  _ddr_base=${DENO_RELEASE_BASE}/${_ddr_version_tag}
  _ddr_tmp=$(mktemp -d)
  _ddr_zip=$_ddr_tmp/$_ddr_zip_name

  curl -fsSL "${_ddr_base}/${_ddr_zip_name}" -o "$_ddr_zip"
  curl -fsSL "${_ddr_base}/${_ddr_zip_name}.sha256sum" -o "$_ddr_tmp/${_ddr_zip_name}.sha256sum"
  (
    cd "$_ddr_tmp" || exit 1
    sha256sum -c "${_ddr_zip_name}.sha256sum"
  )
  unzip -qo "$_ddr_zip" -d "$_ddr_tmp"
  chmod +x "$_ddr_tmp/deno"
  tp_install_deno_binary "$_ddr_tmp/deno"
  rm -rf "$_ddr_tmp"
}

tp_install_deno_runtime() {
  if tp_deno_runtime_usable; then
    tp_cleanup_legacy_deno_runtime
    return 0
  fi

  _upgrading=0
  if [ -x "$DENO_BIN" ]; then
    _upgrading=1
  fi

  tp_ensure_deno_prerequisites

  if [ "$_upgrading" -eq 1 ]; then
    tp_info "Upgrading Deno to v${DENO_VERSION} at ${DENO_BIN}"
  else
    tp_info "Installing Deno v${DENO_VERSION} to ${DENO_BIN}"
  fi

  tp_download_deno_release

  if ! tp_deno_runtime_usable; then
    tp_error "Deno install failed — expected v${DENO_VERSION} at ${DENO_BIN}"
    exit 1
  fi

  if [ "$_upgrading" -eq 1 ]; then
    tp_success "Deno upgraded to v${DENO_VERSION}"
  else
    tp_success "Deno v${DENO_VERSION} installed"
  fi

  tp_cleanup_legacy_deno_runtime
}

tp_ensure_deno_runtime() {
  tp_install_deno_runtime
}

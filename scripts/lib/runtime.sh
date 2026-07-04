# Install the pinned Node release from nodejs.org into the vendored runtime tree
# (default /opt/turbopanel/lib/runtime/node/<version>/ with a current symlink).
# Bump NODE_VERSION in paths.sh; ./console installs or upgrades on the next run.
# Source after privileges.sh, paths.sh, and packages.sh.

tp_node_linux_asset() {
  case $(uname -m) in
    aarch64|arm64) printf '%s' 'arm64' ;;
    x86_64|amd64) printf '%s' 'x64' ;;
    *)
      tp_error "Unsupported Linux architecture for Node: $(uname -m)"
      exit 1
      ;;
  esac
}

tp_node_installed_version() {
  [ -x "$NODE_BIN" ] || return 1
  "$NODE_BIN" --version 2>/dev/null | sed 's/^v//'
}

tp_node_runtime_usable() {
  _tnu_version=$(tp_node_installed_version) || return 1
  [ "$_tnu_version" = "$NODE_VERSION" ]
}

tp_ensure_node_runtime_dir() {
  if [ "$(id -u)" -eq 0 ] || tp_can_write_path "$NODE_RUNTIME_DIR"; then
    mkdir -p "$NODE_VERSION_DIR"
    return 0
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    tp_error "Installing Node to ${NODE_RUNTIME_DIR} requires root privileges, but sudo is not installed."
    exit 1
  fi
  tp_info "Administrator privileges required to install Node to ${NODE_RUNTIME_DIR}"
  sudo mkdir -p "$NODE_VERSION_DIR"
}

tp_install_node_tree() {
  _int_src_dir=$1
  tp_ensure_node_runtime_dir
  if [ "$(id -u)" -eq 0 ] || tp_can_write_path "$NODE_VERSION_DIR"; then
    cp -R "$_int_src_dir"/bin "$_int_src_dir"/include "$_int_src_dir"/lib "$_int_src_dir"/share "$NODE_VERSION_DIR"/
  else
    sudo cp -R "$_int_src_dir"/bin "$_int_src_dir"/include "$_int_src_dir"/lib "$_int_src_dir"/share "$NODE_VERSION_DIR"/
  fi
  tp_link_node_current
}

tp_link_node_current() {
  if [ "$(id -u)" -eq 0 ] || tp_can_write_path "$NODE_RUNTIME_DIR"; then
    ln -sfn "$NODE_VERSION_DIR" "$NODE_RUNTIME_DIR/current"
    return 0
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    tp_error "Updating Node current symlink requires root privileges, but sudo is not installed."
    exit 1
  fi
  sudo ln -sfn "$NODE_VERSION_DIR" "$NODE_RUNTIME_DIR/current"
}

tp_download_node_release() {
  _dnr_arch=$(tp_node_linux_asset)
  _dnr_name=node-v${NODE_VERSION}-linux-${_dnr_arch}
  _dnr_tarball=${_dnr_name}.tar.xz
  _dnr_base=${NODE_RELEASE_BASE}/v${NODE_VERSION}
  _dnr_tmp=$(mktemp -d)

  curl -fsSL "${_dnr_base}/${_dnr_tarball}" -o "$_dnr_tmp/$_dnr_tarball"
  curl -fsSL "${_dnr_base}/SHASUMS256.txt" -o "$_dnr_tmp/SHASUMS256.txt"
  (
    cd "$_dnr_tmp" || exit 1
    grep " ${_dnr_tarball}\$" SHASUMS256.txt > "${_dnr_tarball}.sha256"
    sha256sum -c "${_dnr_tarball}.sha256"
  )
  tar -xJf "$_dnr_tmp/$_dnr_tarball" -C "$_dnr_tmp"
  rm -rf "$NODE_VERSION_DIR"
  tp_install_node_tree "$_dnr_tmp/$_dnr_name"
  rm -rf "$_dnr_tmp"
}

tp_install_node_runtime() {
  if tp_node_runtime_usable; then
    return 0
  fi

  _node_upgrading=0
  if [ -x "$NODE_BIN" ]; then
    _node_upgrading=1
  fi

  tp_ensure_node_prerequisites  # curl, tar, xz-utils, sha256sum

  if [ "$_node_upgrading" -eq 1 ]; then
    tp_info "Upgrading Node to v${NODE_VERSION} at ${NODE_BIN}"
  else
    tp_info "Installing Node v${NODE_VERSION} to ${NODE_BIN}"
  fi

  tp_download_node_release

  if ! tp_node_runtime_usable; then
    tp_error "Node install failed — expected v${NODE_VERSION} at ${NODE_BIN}"
    exit 1
  fi

  if [ "$_node_upgrading" -eq 1 ]; then
    tp_success "Node upgraded to v${NODE_VERSION}"
  else
    tp_success "Node v${NODE_VERSION} installed"
  fi
}

tp_read_pnpm_version() {
  _rpv_package_json=$1
  if [ ! -f "$_rpv_package_json" ]; then
    tp_error "package.json not found at ${_rpv_package_json}"
    exit 1
  fi

  _rpv_pm=$(grep '"packageManager"' "$_rpv_package_json" 2>/dev/null \
    | head -1 \
    | sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

  case $_rpv_pm in
    pnpm@*)
      printf '%s' "${_rpv_pm#pnpm@}"
      return 0
      ;;
  esac

  tp_error "package.json must define \"packageManager\": \"pnpm@x.y.z\""
  exit 1
}

tp_corepack_bin() {
  printf '%s' "$NODE_PREFIX/bin/corepack"
}

tp_corepack_env() {
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  export COREPACK_ENABLE_DOWNLOAD_PROMPT
}

tp_run_corepack() {
  tp_corepack_env
  if [ "$(id -u)" -eq 0 ] || tp_can_write_path "$NODE_PREFIX/bin"; then
    "$@"
    return $?
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    tp_error "Corepack requires write access to ${NODE_PREFIX}/bin, but sudo is not installed."
    exit 1
  fi
  sudo env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "$@"
}

tp_pnpm_installed_version() {
  [ -x "$PNPM_BIN" ] || return 1
  tp_corepack_env
  "$PNPM_BIN" --version 2>/dev/null
}

tp_ensure_corepack_pnpm() {
  _ecp_repo_root=$1
  _ecp_corepack=$(tp_corepack_bin)
  if [ ! -x "$_ecp_corepack" ]; then
    tp_error "corepack not found at ${_ecp_corepack} (expected from the Node install)."
    exit 1
  fi

  _ecp_pnpm_version=$(tp_read_pnpm_version "$_ecp_repo_root/package.json")
  _ecp_pnpm_semver=${_ecp_pnpm_version%%+*}

  tp_info "Ensuring pnpm v${_ecp_pnpm_semver} (Corepack)…"
  tp_run_corepack "$_ecp_corepack" enable
  tp_run_corepack "$_ecp_corepack" prepare "pnpm@${_ecp_pnpm_version}" --activate

  _ecp_installed=$(tp_pnpm_installed_version) || true
  if [ "$_ecp_installed" != "$_ecp_pnpm_semver" ]; then
    tp_error "pnpm install failed — expected v${_ecp_pnpm_semver}, got ${_ecp_installed:-<missing>}"
    exit 1
  fi

  tp_success "pnpm v${_ecp_pnpm_semver} ready"
}

tp_ensure_node_runtime() {
  tp_install_node_runtime
}

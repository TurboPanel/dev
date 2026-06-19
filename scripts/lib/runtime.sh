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

# --- Node (dev-only) ---------------------------------------------------------
# Pinned Node from the official nodejs.org tarball, installed into NODE_PREFIX
# (default /usr/local). Provides node + npm + corepack for the Ink HMR dev loop
# and the future website repo. Production services run on Deno, not Node.

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

tp_install_node_tree() {
  _int_src_dir=$1
  if [ "$(id -u)" -eq 0 ] || tp_can_write_path "$NODE_PREFIX"; then
    cp -R "$_int_src_dir"/bin "$_int_src_dir"/include "$_int_src_dir"/lib "$_int_src_dir"/share "$NODE_PREFIX"/
    return 0
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    tp_error "Installing Node to ${NODE_PREFIX} requires root privileges, but sudo is not installed."
    exit 1
  fi
  tp_info "Administrator privileges required to install Node to ${NODE_PREFIX}"
  sudo cp -R "$_int_src_dir"/bin "$_int_src_dir"/include "$_int_src_dir"/lib "$_int_src_dir"/share "$NODE_PREFIX"/
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
  printf '%s' "$(dirname "$NODE_BIN")/corepack"
}

tp_corepack_env() {
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  export COREPACK_ENABLE_DOWNLOAD_PROMPT
}

tp_run_corepack() {
  tp_corepack_env
  if [ "$(id -u)" -eq 0 ] || tp_can_write_path "$(dirname "$NODE_BIN")"; then
    "$@"
    return $?
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    tp_error "Corepack requires write access to $(dirname "$NODE_BIN"), but sudo is not installed."
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

  tp_info "Ensuring pnpm v${_ecp_pnpm_version} (Corepack)…"
  tp_run_corepack "$_ecp_corepack" enable
  tp_run_corepack "$_ecp_corepack" prepare "pnpm@${_ecp_pnpm_version}" --activate

  _ecp_installed=$(tp_pnpm_installed_version) || true
  if [ "$_ecp_installed" != "$_ecp_pnpm_version" ]; then
    tp_error "pnpm install failed — expected v${_ecp_pnpm_version}, got ${_ecp_installed:-<missing>}"
    exit 1
  fi

  tp_success "pnpm v${_ecp_pnpm_version} ready"
}

tp_ensure_node_runtime() {
  tp_install_node_runtime
}

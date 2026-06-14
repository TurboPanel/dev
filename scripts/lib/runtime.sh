# Install the pinned Deno runtime under /opt/turbopanel/runtime.
# Source after privileges.sh and paths.sh.

tp_install_deno_runtime_body() {
  mkdir -p "$DENO_VERSION_DIR"
  DENO_INSTALL="$DENO_VERSION_DIR" \
    curl -fsSL https://deno.land/install.sh | sh -s "v${DENO_VERSION}"
}

tp_install_deno_runtime() {
  if [ -x "$DENO_BIN" ]; then
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1; then
    tp_error "curl is not installed."
    echo "Debian: apt install curl"
    exit 1
  fi

  if ! command -v unzip >/dev/null 2>&1; then
    tp_error "unzip is not installed."
    echo "Debian: apt install unzip"
    exit 1
  fi

  tp_info "Installing Deno v${DENO_VERSION} to ${DENO_VERSION_DIR}"

  if [ "$(id -u)" -eq 0 ] || tp_can_write_path "$TURBOPANEL_ROOT"; then
    tp_install_deno_runtime_body
  else
    if ! command -v sudo >/dev/null 2>&1; then
      tp_error "Write access to ${TURBOPANEL_ROOT} requires root privileges, but sudo is not installed."
      exit 1
    fi
    tp_info "Administrator privileges required for ${TURBOPANEL_ROOT}"
    sudo sh -c "
      DENO_VERSION_DIR='$DENO_VERSION_DIR' \
      DENO_VERSION='$DENO_VERSION' \
      mkdir -p \"\$DENO_VERSION_DIR\" && \
      DENO_INSTALL=\"\$DENO_VERSION_DIR\" \
        curl -fsSL https://deno.land/install.sh | sh -s \"v\${DENO_VERSION}\"
    "
  fi

  if [ ! -x "$DENO_BIN" ]; then
    tp_error "Deno install failed — expected ${DENO_BIN}"
    exit 1
  fi

  tp_success "Deno v${DENO_VERSION} installed"
}

tp_ensure_deno_runtime() {
  tp_install_deno_runtime
}

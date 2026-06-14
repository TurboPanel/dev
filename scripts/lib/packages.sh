# Install missing Debian packages when required commands are absent.
# Source after privileges.sh.

tp_run_apt_install() {
  _packages=$1
  if [ "$(id -u)" -eq 0 ]; then
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y $_packages
    return 0
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    tp_error "Cannot install packages (need root or sudo): ${_packages}"
    exit 1
  fi
  tp_info "Administrator privileges required to install:${_packages}"
  sudo apt-get update -qq
  DEBIAN_FRONTEND=noninteractive sudo apt-get install -y $_packages
}

tp_ensure_deno_prerequisites() {
  _missing=
  if ! command -v curl >/dev/null 2>&1; then
    _missing="${_missing} curl"
  fi
  if ! command -v unzip >/dev/null 2>&1; then
    _missing="${_missing} unzip"
  fi
  if [ -z "$_missing" ]; then
    return 0
  fi

  tp_info "Missing packages:${_missing}"
  tp_run_apt_install "$_missing"

  if ! command -v curl >/dev/null 2>&1; then
    tp_error "curl is still not available after install."
    exit 1
  fi
  if ! command -v unzip >/dev/null 2>&1; then
    tp_error "unzip is still not available after install."
    exit 1
  fi

  tp_success "Prerequisites ready"
}

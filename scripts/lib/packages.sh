# Install missing Debian packages when required commands are absent.
# Source after privileges.sh.

# Wait for the dpkg/frontend lock instead of failing instantly when another apt
# process (e.g. unattended-upgrades on a fresh boot) holds it.
TP_APT_LOCK_OPT="-o DPkg::Lock::Timeout=300"

tp_run_apt_install() {
  _packages=$1
  if [ "$(id -u)" -eq 0 ]; then
    apt-get $TP_APT_LOCK_OPT update -qq
    DEBIAN_FRONTEND=noninteractive apt-get $TP_APT_LOCK_OPT install -y $_packages
    return 0
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    tp_error "Cannot install packages (need root or sudo): ${_packages}"
    exit 1
  fi
  tp_info "Administrator privileges required to install:${_packages}"
  sudo apt-get $TP_APT_LOCK_OPT update -qq
  DEBIAN_FRONTEND=noninteractive sudo apt-get $TP_APT_LOCK_OPT install -y $_packages
}

# Node tarballs are .tar.xz, so we need tar + xz (and curl/sha256sum) available.
tp_ensure_node_prerequisites() {
  _node_missing=
  if ! command -v curl >/dev/null 2>&1; then
    _node_missing="${_node_missing} curl"
  fi
  if ! command -v tar >/dev/null 2>&1; then
    _node_missing="${_node_missing} tar"
  fi
  if ! command -v xz >/dev/null 2>&1; then
    _node_missing="${_node_missing} xz-utils"
  fi
  if ! command -v sha256sum >/dev/null 2>&1; then
    _node_missing="${_node_missing} coreutils"
  fi
  if [ -z "$_node_missing" ]; then
    return 0
  fi

  tp_info "Missing packages:${_node_missing}"
  tp_run_apt_install "$_node_missing"

  if ! command -v xz >/dev/null 2>&1; then
    tp_error "xz is still not available after install (needed to extract Node)."
    exit 1
  fi
}

# Install missing host-base commands required before vendoring Node.
# TurboPanel-managed runtimes live under vendor — this script never apt-installs
# vendor bootstrap tools (xz-utils/unzip); Node releases use .tar.gz + tar instead.
# Source after privileges.sh.

tp_require_host_commands() {
  _missing=
  if ! command -v curl >/dev/null 2>&1; then
    _missing="${_missing} curl"
  fi
  if ! command -v tar >/dev/null 2>&1; then
    _missing="${_missing} tar"
  fi
  if ! command -v sha256sum >/dev/null 2>&1; then
    _missing="${_missing} sha256sum"
  fi
  if [ -n "$_missing" ]; then
    tp_error "Missing host-base commands:${_missing} (install via apt before ./console)"
    exit 1
  fi
}

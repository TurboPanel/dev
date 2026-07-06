# Prerequisites for scripts/develop.sh and ./console (curl, sudo, dev sudoer).
# Source after privileges.sh and dev-identity.sh.

TP_DEV_NOPASSWD_SUDOERS=/etc/sudoers.d/turbopanel-dev-nopasswd

tp_dev_user_is_sudoer() {
  _duis_user=$1
  [ -n "$_duis_user" ] || return 1
  id -nG "$_duis_user" 2>/dev/null | tr ' ' '\n' | grep -qx sudo && return 0
  id -nG "$_duis_user" 2>/dev/null | tr ' ' '\n' | grep -qx wheel && return 0
  id -nG "$_duis_user" 2>/dev/null | tr ' ' '\n' | grep -qx admin && return 0
  return 1
}

tp_dev_user_has_passwordless_sudo() {
  sudo -n true 2>/dev/null
}

tp_install_dev_passwordless_sudo() {
  _idps_user=$1
  _idps_tmp=$(mktemp)
  _idps_file=$TP_DEV_NOPASSWD_SUDOERS

  cat > "$_idps_tmp" <<EOF
# TurboPanel development passwordless sudo for ${_idps_user}
# Installed by turbopanel/dev scripts/develop.sh — remove this file to revert.
${_idps_user} ALL=(ALL) NOPASSWD: ALL
EOF

  if ! sudo visudo -cf "$_idps_tmp" >/dev/null 2>&1; then
    tp_error "Generated sudoers fragment failed validation."
    rm -f "$_idps_tmp"
    return 1
  fi

  tp_info "Installing ${_idps_file} (enter your sudo password once)…"
  if ! sudo install -m 440 "$_idps_tmp" "$_idps_file"; then
    rm -f "$_idps_tmp"
    return 1
  fi
  rm -f "$_idps_tmp"

  if tp_dev_user_has_passwordless_sudo; then
    tp_success "Passwordless sudo enabled for ${_idps_user}"
    return 0
  fi

  tp_warn "Sudoers fragment installed but passwordless sudo was not verified."
  return 1
}

tp_offer_dev_passwordless_sudo() {
  if tp_dev_user_has_passwordless_sudo; then
    return 0
  fi

  if [ -n "${TURBOPANEL_DEV_SKIP_NOPASSWD_SUDO:-}" ]; then
    return 1
  fi

  if ! tp_is_interactive; then
    return 1
  fi

  tp_info "${TP_DEV_USER} must authenticate with sudo during setup."
  if ! tp_read_tty_yn \
    "Configure passwordless sudo for ${TP_DEV_USER}? (recommended on local dev hosts only)" \
    n; then
    return 1
  fi

  tp_install_dev_passwordless_sudo "$TP_DEV_USER"
}

tp_ensure_dev_prerequisites() {
  if ! command -v curl >/dev/null 2>&1; then
    tp_error "curl is required before running the TurboPanel dev environment."
    echo "  sudo apt install curl" >&2
    exit 1
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    tp_error "sudo is required before running the TurboPanel dev environment."
    echo "  apt install sudo" >&2
    echo "  usermod -aG sudo <dev-user>" >&2
    exit 1
  fi

  if ! tp_resolve_dev_identity; then
    tp_error "Run develop.sh as your development user, not root."
    tp_error "If you use sudo, invoke: sh scripts/develop.sh (not sudo sh scripts/develop.sh)."
    exit 1
  fi

  if ! tp_dev_user_is_sudoer "$TP_DEV_USER"; then
    tp_error "Development user ${TP_DEV_USER} is not a sudoer."
    echo "  sudo usermod -aG sudo ${TP_DEV_USER}" >&2
    echo "  Log out and back in, then re-run develop.sh." >&2
    exit 1
  fi

  if ! tp_dev_user_has_passwordless_sudo; then
    tp_offer_dev_passwordless_sudo || true
  fi

  if ! tp_dev_user_has_passwordless_sudo; then
    tp_info "Verifying sudo access for ${TP_DEV_USER}…"
    if ! sudo -v; then
      tp_error "sudo authentication failed for ${TP_DEV_USER}"
      exit 1
    fi
  fi
}

case $(basename "$0") in
  dev-prerequisites.sh)
    _tp_dp_lib_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
    # shellcheck source=scripts/lib/privileges.sh
    . "$_tp_dp_lib_dir/privileges.sh"
    # shellcheck source=scripts/lib/dev-identity.sh
    . "$_tp_dp_lib_dir/dev-identity.sh"
    tp_ensure_dev_prerequisites
    tp_success "Dev prerequisites OK (${TP_DEV_USER})"
    ;;
esac

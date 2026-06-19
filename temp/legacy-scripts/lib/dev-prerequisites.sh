# Prerequisites for scripts/develop.sh and ./console (curl, sudo, dev sudoer).
# Source after privileges.sh and dev-identity.sh.

tp_dev_user_is_sudoer() {
  _duis_user=$1
  [ -n "$_duis_user" ] || return 1
  id -nG "$_duis_user" 2>/dev/null | tr ' ' '\n' | grep -qx sudo && return 0
  id -nG "$_duis_user" 2>/dev/null | tr ' ' '\n' | grep -qx wheel && return 0
  id -nG "$_duis_user" 2>/dev/null | tr ' ' '\n' | grep -qx admin && return 0
  return 1
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

  if ! sudo -n true 2>/dev/null; then
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

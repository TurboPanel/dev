#!/bin/sh
set -eu

REPO_NAME=dev
REPO_SLUG=turbopanel/dev
REPO_URL=git@github.com:${REPO_SLUG}.git
BRANCH=trunk

# HTTPS-only fetch (block clear-text redirect downgrades; Sonar shell:S6506).
tp_curl_fetch() {
  curl -fsSL --proto "=https" --proto-redir "=https" "$@"
}

# Piped bootstrap (curl | sh): $0 is "sh", not a path to this script. Re-fetch the
# latest develop.sh via GitHub API (fresh) instead of relying on a cached trunk URL.
case $0 in
  */develop.sh) ;;
  *)
    if [ -z "${TURBOPANEL_DEV_BOOTSTRAPPED:-}" ]; then
      _tp_sha=$(tp_curl_fetch "https://api.github.com/repos/${REPO_SLUG}/git/ref/heads/${BRANCH}" 2>/dev/null \
        | tr ',' '\n' | sed -n 's/.*"sha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
      if [ -n "$_tp_sha" ]; then
        _tp_fresh=$(mktemp)
        if tp_curl_fetch "https://raw.githubusercontent.com/${REPO_SLUG}/${_tp_sha}/scripts/develop.sh" -o "$_tp_fresh" 2>/dev/null; then
          TURBOPANEL_DEV_BOOTSTRAPPED=1
          export TURBOPANEL_DEV_BOOTSTRAPPED
          exec sh "$_tp_fresh" "$@"
        fi
        rm -f "$_tp_fresh"
      fi
    fi
    ;;
esac

# Load helper libraries from the checkout when available; otherwise download them.
_tp_install_lib_dir=
case $0 in
  */develop.sh)
    _tp_candidate=$(CDPATH= cd -- "$(dirname "$0")" && pwd)/lib
    if [ -f "$_tp_candidate/privileges.sh" ]; then
      _tp_install_lib_dir=$_tp_candidate
    fi
    ;;
  *) ;;
esac
if [ -z "$_tp_install_lib_dir" ]; then
  _tp_lib_base=${TURBOPANEL_DEV_LIB_BASE:-https://raw.githubusercontent.com/turbopanel/dev/trunk/scripts/lib}
  _tp_install_lib_dir=$(mktemp -d)
  for _tp_lib in privileges.sh dev-identity.sh dev-prerequisites.sh git-github-ssh.sh; do
    tp_curl_fetch "$_tp_lib_base/$_tp_lib" -o "$_tp_install_lib_dir/$_tp_lib"
  done
fi
# shellcheck source=scripts/lib/privileges.sh
. "$_tp_install_lib_dir/privileges.sh"
# shellcheck source=scripts/lib/dev-identity.sh
. "$_tp_install_lib_dir/dev-identity.sh"
# shellcheck source=scripts/lib/dev-prerequisites.sh
. "$_tp_install_lib_dir/dev-prerequisites.sh"
# shellcheck source=scripts/lib/git-github-ssh.sh
. "$_tp_install_lib_dir/git-github-ssh.sh"

resolve_repo_dir() {
  case $0 in
    */develop.sh)
      _script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
      _repo_dir=$(CDPATH= cd -- "$_script_dir/.." && pwd)
      if [ -d "$_repo_dir/.git" ]; then
        printf '%s' "$_repo_dir"
        return 0
      fi
      ;;
    *) ;;
  esac
  _tp_dev_root=${TURBOPANEL_DEV_ROOT:-$HOME}
  printf '%s' "$_tp_dev_root/dev"
}

ensure_git() {
  if command -v git >/dev/null 2>&1; then
    return 0
  fi

  tp_info "git is not installed — installing…"

  _apt_lock_opt="-o DPkg::Lock::Timeout=300"
  if [ "$(id -u)" -eq 0 ]; then
    apt-get $_apt_lock_opt update -qq
    DEBIAN_FRONTEND=noninteractive apt-get $_apt_lock_opt install -y git
  elif command -v sudo >/dev/null 2>&1; then
    tp_info "Administrator privileges required to install git"
    sudo apt-get $_apt_lock_opt update -qq
    DEBIAN_FRONTEND=noninteractive sudo apt-get $_apt_lock_opt install -y git
  else
    tp_error "git is not installed and sudo is not available."
    echo "Install git manually: apt install git"
    exit 1
  fi

  if ! command -v git >/dev/null 2>&1; then
    tp_error "git is still not available after install."
    exit 1
  fi

  tp_success "git installed"
}

ensure_origin_url() {
  _eou_dir=$1
  _eou_url=$2
  _eou_current=$(git -C "$_eou_dir" remote get-url origin 2>/dev/null || true)
  if [ "$_eou_current" != "$_eou_url" ]; then
    git -C "$_eou_dir" remote set-url origin "$_eou_url"
  fi
}

clone_or_update_repo() {
  _cor_target=$1
  if [ ! -d "$_cor_target" ]; then
    git clone --branch "$BRANCH" "$REPO_URL" "$_cor_target"
    tp_success "Cloned ${REPO_NAME}"
    return 0
  fi

  if ! git -C "$_cor_target" rev-parse --git-dir >/dev/null 2>&1; then
    tp_error "${_cor_target} exists but is not a git repository."
    exit 1
  fi

  ensure_origin_url "$_cor_target" "$REPO_URL"

  if [ -n "$(git -C "$_cor_target" status --porcelain)" ]; then
    tp_info "${REPO_NAME} has uncommitted changes — leaving checkout untouched."
    return 0
  fi

  git -C "$_cor_target" pull --ff-only origin "$BRANCH"
  tp_success "Updated ${REPO_NAME}"
}

if ! tp_is_interactive; then
  tp_error "Run in an interactive terminal (curl -fsSL trbp.nl/develop.sh | sh)."
  exit 1
fi

tp_ensure_dev_prerequisites
ensure_git
tp_ensure_github_ssh "$REPO_SLUG"

REPO_DIR=$(resolve_repo_dir)
clone_or_update_repo "$REPO_DIR"

tp_success "TurboPanel dev checkout ready at ${REPO_DIR}"
cd "$REPO_DIR"
exec ./console

#!/bin/sh
set -eu

REPO_NAME=turbopanel-dev
REPO_SLUG=turbopanel/turbopanel-dev
REPO_URL=git@github.com:${REPO_SLUG}.git
BRANCH=trunk

_tp_install_lib_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd 2>/dev/null)/lib
if [ ! -f "$_tp_install_lib_dir/privileges.sh" ]; then
  _tp_lib_base=${TURBOPANEL_DEV_LIB_BASE:-https://raw.githubusercontent.com/turbopanel/turbopanel-dev/trunk/scripts/lib}
  _tp_install_lib_dir=$(mktemp -d)
  for _tp_lib in privileges.sh git-github-ssh.sh; do
    curl -fsSL "$_tp_lib_base/$_tp_lib" -o "$_tp_install_lib_dir/$_tp_lib"
  done
fi
# shellcheck source=scripts/lib/privileges.sh
. "$_tp_install_lib_dir/privileges.sh"
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
  esac
  printf '%s' "$(CDPATH= cd -- "$(pwd)" && pwd)/${REPO_NAME}"
}

ensure_git() {
  if command -v git >/dev/null 2>&1; then
    return 0
  fi

  tp_info "git is not installed — installing…"

  if [ "$(id -u)" -eq 0 ]; then
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y git
  elif command -v sudo >/dev/null 2>&1; then
    tp_info "Administrator privileges required to install git"
    sudo apt-get update -qq
    DEBIAN_FRONTEND=noninteractive sudo apt-get install -y git
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

ensure_git
tp_ensure_github_ssh "$REPO_SLUG"

REPO_DIR=$(resolve_repo_dir)
clone_or_update_repo "$REPO_DIR"

echo
tp_success "TurboPanel dev checkout ready!"
echo
echo "  ${REPO_DIR}"
echo
tp_info "Start the developer console:"
echo "  cd ${REPO_DIR}"
echo "  ./console"
echo

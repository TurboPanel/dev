#!/bin/sh
set -eu

REPO_NAME=turbopanel-dev
REPO_URL=git@github.com:turbopanel/turbopanel-dev.git
BRANCH=trunk

info() {
  printf '→ %s\n' "$*"
}

error() {
  printf '✗ %s\n' "$*" >&2
}

success() {
  printf '✓ %s\n' "$*"
}

resolve_repo_dir() {
  case $0 in
    */install.sh)
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

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    error "$1 is not installed."
    echo "Debian: apt install $2"
    exit 1
  fi
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
    success "Cloned ${REPO_NAME}"
    return 0
  fi

  if ! git -C "$_cor_target" rev-parse --git-dir >/dev/null 2>&1; then
    error "${_cor_target} exists but is not a git repository."
    exit 1
  fi

  ensure_origin_url "$_cor_target" "$REPO_URL"

  if [ -n "$(git -C "$_cor_target" status --porcelain)" ]; then
    info "${REPO_NAME} has uncommitted changes — leaving checkout untouched."
    return 0
  fi

  git -C "$_cor_target" pull --ff-only origin "$BRANCH"
  success "Updated ${REPO_NAME}"
}

require_command git git

REPO_DIR=$(resolve_repo_dir)
clone_or_update_repo "$REPO_DIR"

echo
success "TurboPanel dev checkout ready!"
echo
echo "  ${REPO_DIR}"
echo
info "Start the developer console:"
echo "  cd ${REPO_DIR}"
echo "  ./console"
echo

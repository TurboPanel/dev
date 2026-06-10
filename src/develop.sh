#!/bin/sh
set -eu

# Colour helpers
if [ -t 1 ]; then
  BOLD=$(printf '\033[1m')
  RED=$(printf '\033[31m')
  YELLOW=$(printf '\033[33m')
  GREEN=$(printf '\033[32m')
  CYAN=$(printf '\033[36m')
  RESET=$(printf '\033[0m')
else
  BOLD=
  RED=
  YELLOW=
  GREEN=
  CYAN=
  RESET=
fi

info() {
  printf '%b→%b %s\n' "$CYAN" "$RESET" "$*"
}

success() {
  printf '%b✓%b %s\n' "$GREEN" "$RESET" "$*"
}

warn() {
  printf '%b⚠%b %s\n' "$YELLOW" "$RESET" "$*"
}

error() {
  printf '%b✗%b %s\n' "$RED" "$RESET" "$*" >&2
}

# Prerequisite checks
if ! command -v node >/dev/null 2>&1; then
  error "Node.js is not installed."
  echo "Install from https://nodejs.org"
  exit 1
fi

node_version=$(node --version)
node_major=${node_version#v}
node_major=${node_major%%.*}
case $node_major in
  '' | *[!0-9]*)
    error "Node.js v24.x or later is required (found ${node_version})."
    echo "Install from https://nodejs.org"
    exit 1
    ;;
  *)
    if [ "$node_major" -lt 24 ]; then
      error "Node.js v24.x or later is required (found ${node_version})."
      echo "Install from https://nodejs.org"
      exit 1
    fi
    ;;
esac

if ! command -v pnpm >/dev/null 2>&1; then
  error "pnpm is not installed."
  echo "Install from https://pnpm.io/installation"
  exit 1
fi

pnpm_major=$(pnpm --version | cut -d. -f1)
case $pnpm_major in
  '' | *[!0-9]*)
    error "pnpm v11.x or later is required (found $(pnpm --version))."
    echo "Install from https://pnpm.io/installation"
    exit 1
    ;;
  *)
    if [ "$pnpm_major" -lt 11 ]; then
      error "pnpm v11.x or later is required (found $(pnpm --version))."
      echo "Install from https://pnpm.io/installation"
      exit 1
    fi
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  error "Docker is not installed."
  echo "Install from https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  error "Docker daemon is not running."
  echo "Install from https://docs.docker.com/get-docker/"
  exit 1
fi

if ! command -v tilt >/dev/null 2>&1; then
  error "Tilt is not installed."
  echo "Install from https://docs.tilt.dev/install.html"
  exit 1
fi

# Self-detection (piped runs use $0=sh; direct runs use a path ending in develop.sh)
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)

RUNNING_FROM_CHECKOUT=false
case $0 in
  */develop.sh | develop.sh)
    if [ "$(git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree 2>/dev/null || echo false)" = "true" ]; then
      origin_url=$(git -C "$SCRIPT_DIR" remote get-url origin 2>/dev/null || true)
      case $origin_url in
        *turbopanel/turbopanel-dev*)
          RUNNING_FROM_CHECKOUT=true
          DEV_REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)
          DEFAULT_ROOT=$(dirname "$DEV_REPO_ROOT")
          ;;
      esac
    fi
    ;;
esac

resolve_install_root() {
  _rir_input=$1
  if [ -z "$_rir_input" ]; then
    _rir_input=~/turbopanel
  fi
  case $_rir_input in
    '~') _rir_input=$HOME ;;
    '~/'*) _rir_input=$HOME/${_rir_input#~/} ;;
  esac
  if command -v realpath >/dev/null 2>&1; then
    realpath --canonicalize-missing "$_rir_input"
  else
    mkdir -p "$_rir_input"
    (CDPATH= cd -- "$_rir_input" && pwd)
  fi
}

# Prompt for install location
if [ "$RUNNING_FROM_CHECKOUT" = true ]; then
  INSTALL_ROOT=$DEFAULT_ROOT
  info "Running from a turbopanel-dev checkout — using install root: ${INSTALL_ROOT}"
elif [ -n "${TURBOPANEL_INSTALL_ROOT:-}" ]; then
  INSTALL_ROOT=$(resolve_install_root "$TURBOPANEL_INSTALL_ROOT")
  info "Using install root from TURBOPANEL_INSTALL_ROOT: ${INSTALL_ROOT}"
elif [ $# -gt 0 ]; then
  INSTALL_ROOT=$(resolve_install_root "$1")
  info "Using install root from argument: ${INSTALL_ROOT}"
elif [ -r /dev/tty ] && [ -w /dev/tty ]; then
  printf '%s' "Where would you like to install the TurboPanel directory? [default: ~/turbopanel]: " >/dev/tty
  read -r input </dev/tty || input=
  INSTALL_ROOT=$(resolve_install_root "$input")
else
  warn "No controlling terminal — using default install root: ~/turbopanel"
  INSTALL_ROOT=$(resolve_install_root "")
fi

SKIPPED_REPOS=

clone_or_update() {
  _co_url=$1
  _co_target=$2
  _co_branch=$3
  _co_name=$(basename "$_co_target")

  if [ ! -d "$_co_target" ]; then
    git clone --branch "$_co_branch" "$_co_url" "$_co_target"
    success "Cloned ${_co_name}"
    return 0
  fi

  if ! git -C "$_co_target" rev-parse --git-dir >/dev/null 2>&1; then
    error "${_co_target} exists but is not a git repository — skipping."
    return 0
  fi

  if [ -n "$(git -C "$_co_target" status --porcelain)" ]; then
    warn "${_co_name} has uncommitted changes — leaving untouched."
    SKIPPED_REPOS="${SKIPPED_REPOS}${SKIPPED_REPOS:+:}${_co_name}"
    return 0
  fi

  git -C "$_co_target" pull --ff-only origin "$_co_branch"
  success "Updated ${_co_name}"
}

# Clone/update all repos
BRANCH=trunk

mkdir -p "$INSTALL_ROOT"

if [ "$RUNNING_FROM_CHECKOUT" != true ]; then
  clone_or_update "https://github.com/turbopanel/turbopanel-dev" "$INSTALL_ROOT/dev" "$BRANCH"
fi

clone_or_update "https://github.com/turbopanel/turbopanel" "$INSTALL_ROOT/instance" "$BRANCH"
clone_or_update "https://github.com/turbopanel/turbopanel-ui" "$INSTALL_ROOT/ui" "$BRANCH"
clone_or_update "https://github.com/turbopanel/turbopanel-daemon" "$INSTALL_ROOT/daemon" "$BRANCH"

# Post-install summary
echo
success "TurboPanel development environment ready!"
echo
echo "  ${INSTALL_ROOT}/"
echo "  ├── dev/      (turbopanel/turbopanel-dev)"
echo "  ├── instance/ (turbopanel/turbopanel)"
echo "  ├── ui/       (turbopanel/turbopanel-ui)"
echo "  └── daemon/   (turbopanel/turbopanel-daemon)"
echo

if [ -n "$SKIPPED_REPOS" ]; then
  warn "The following repos were skipped due to uncommitted changes:"
  _old_ifs=$IFS
  IFS=:
  for repo in $SKIPPED_REPOS; do
    echo "    - ${repo}"
  done
  IFS=$_old_ifs
  echo
fi

info "Start local dev (Workers via pnpm/wrangler, proxied by Caddy):"
echo "  cd ${INSTALL_ROOT}/dev"
echo "  cp .env.example .env   # once"
echo "  tilt up"
echo

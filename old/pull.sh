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

# Self-detection (piped runs use $0=sh; direct runs use a path ending in pull.sh)
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)

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
  if command -v bash >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/scripts/ensure-pnpm.sh" ]; then
    info "pnpm not found — activating via corepack or npm exec"
    bash "$SCRIPT_DIR/scripts/ensure-pnpm.sh" || {
      error "pnpm is not installed."
      echo "Enable corepack (corepack enable) or install from https://pnpm.io/installation"
      exit 1
    }
  else
    error "pnpm is not installed."
    echo "Enable corepack (corepack enable) or install from https://pnpm.io/installation"
    exit 1
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  success "pnpm available via npm exec ($(bash "$SCRIPT_DIR/scripts/ensure-pnpm.sh" --version))"
else
  pnpm_major=$(pnpm --version | cut -d. -f1)
  case $pnpm_major in
    '' | *[!0-9]*)
      error "pnpm v11.x or later is required (found $(pnpm --version))."
      echo "Enable corepack (corepack enable) or install from https://pnpm.io/installation"
      exit 1
      ;;
    *)
      if [ "$pnpm_major" -lt 11 ]; then
        error "pnpm v11.x or later is required (found $(pnpm --version))."
        echo "Enable corepack (corepack enable) or install from https://pnpm.io/installation"
        exit 1
      fi
      ;;
  esac
fi

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

if ! command -v deno >/dev/null 2>&1; then
  error "Deno is not installed."
  echo "Install from https://docs.deno.com/runtime/getting_started/installation/"
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  error "openssl is not installed."
  echo "macOS: brew install openssl"
  echo "Debian/Ubuntu: apt install openssl"
  exit 1
fi

trim_whitespace() {
  _tw=$1
  while [ -n "$_tw" ]; do
    case $_tw in
      ' '*) _tw=${_tw#?} ;;
      *' ') _tw=${_tw%?} ;;
      *'	'*) _tw=${_tw%?} ;;
      '	'*) _tw=${_tw#?} ;;
      *) break ;;
    esac
  done
  printf '%s' "$_tw"
}

is_turbopanel_dev_repo() {
  _itdr_dir=$1
  [ -d "$_itdr_dir" ] || return 1
  [ "$(git -C "$_itdr_dir" rev-parse --is-inside-work-tree 2>/dev/null || echo false)" = "true" ] || return 1
  _itdr_origin=$(git -C "$_itdr_dir" remote get-url origin 2>/dev/null || true)
  case $_itdr_origin in
    *turbopanel/turbopanel-dev*) return 0 ;;
    *) return 1 ;;
  esac
}

detect_install_root_from_dir() {
  _dird_start=$1
  _dird_dir=$_dird_start
  while [ "$_dird_dir" != "/" ]; do
    if is_turbopanel_dev_repo "$_dird_dir"; then
      dirname "$_dird_dir"
      return 0
    fi
    if [ -d "$_dird_dir/dev" ] && is_turbopanel_dev_repo "$_dird_dir/dev"; then
      printf '%s' "$_dird_dir"
      return 0
    fi
    _dird_dir=$(dirname "$_dird_dir")
  done
  return 1
}

resolve_install_root() {
  _rir_input=$(trim_whitespace "$1")
  if [ -z "$_rir_input" ]; then
    _rir_input=~/turbopanel
  fi
  case $_rir_input in
    '~') _rir_input=$HOME ;;
    '~'/*) _rir_input=$HOME/${_rir_input#\~/} ;;
  esac
  if command -v realpath >/dev/null 2>&1; then
    realpath --canonicalize-missing "$_rir_input"
  else
    mkdir -p "$_rir_input"
    (CDPATH= cd -- "$_rir_input" && pwd)
  fi
}

INSTALL_ROOT=
DETECTED_EXISTING_CHECKOUT=false

case $0 in
  */pull.sh | pull.sh)
    if is_turbopanel_dev_repo "$SCRIPT_DIR"; then
      DETECTED_EXISTING_CHECKOUT=true
      INSTALL_ROOT=$(dirname "$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)")
    fi
    ;;
esac

if [ -z "$INSTALL_ROOT" ]; then
  if detected_root=$(detect_install_root_from_dir "$(pwd)"); then
    DETECTED_EXISTING_CHECKOUT=true
    INSTALL_ROOT=$detected_root
  fi
fi

# Prompt for install location
if [ "$DETECTED_EXISTING_CHECKOUT" = true ]; then
  info "Detected existing TurboPanel checkout — using install root: ${INSTALL_ROOT}"
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

clone_or_update "https://github.com/turbopanel/turbopanel-dev" "$INSTALL_ROOT/dev" "$BRANCH"
clone_or_update "https://github.com/turbopanel/turbopanel" "$INSTALL_ROOT/instance" "$BRANCH"
clone_or_update "https://github.com/turbopanel/turbopanel-ui" "$INSTALL_ROOT/ui" "$BRANCH"
clone_or_update "https://github.com/turbopanel/turbopanel-daemon" "$INSTALL_ROOT/daemon" "$BRANCH"
clone_or_update "https://github.com/turbopanel/turbopanel-website" "$INSTALL_ROOT/website" "$BRANCH"

# Post-install summary
echo
success "TurboPanel development environment ready!"
echo
echo "  ${INSTALL_ROOT}/"
echo "  ├── dev/      (turbopanel/turbopanel-dev)"
echo "  ├── instance/ (turbopanel/turbopanel)"
echo "  ├── ui/       (turbopanel/turbopanel-ui)"
echo "  ├── daemon/   (turbopanel/turbopanel-daemon)"
echo "  └── website/  (turbopanel/turbopanel-website)"
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

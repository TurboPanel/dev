#!/usr/bin/env bash
set -euo pipefail

# Colour helpers
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'
  RED=$'\033[31m'
  YELLOW=$'\033[33m'
  GREEN=$'\033[32m'
  CYAN=$'\033[36m'
  RESET=$'\033[0m'
else
  BOLD=''
  RED=''
  YELLOW=''
  GREEN=''
  CYAN=''
  RESET=''
fi

info() {
  echo -e "${CYAN}→${RESET} $*"
}

success() {
  echo -e "${GREEN}✓${RESET} $*"
}

warn() {
  echo -e "${YELLOW}⚠${RESET} $*"
}

error() {
  echo -e "${RED}✗${RESET} $*" >&2
}

# Prerequisite checks
if ! command -v node >/dev/null 2>&1; then
  error "Node.js is not installed."
  echo "Install from https://nodejs.org"
  exit 1
fi

node_version="$(node --version)"
node_major="${node_version#v}"
node_major="${node_major%%.*}"
if (( node_major < 24 )); then
  error "Node.js v24.x or later is required (found ${node_version})."
  echo "Install from https://nodejs.org"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  error "pnpm is not installed."
  echo "Install from https://pnpm.io/installation"
  exit 1
fi

pnpm_major="$(pnpm --version | cut -d. -f1)"
if [[ -z "$pnpm_major" ]] || (( pnpm_major < 11 )); then
  error "pnpm v11.x or later is required (found $(pnpm --version))."
  echo "Install from https://pnpm.io/installation"
  exit 1
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

# Self-detection
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

RUNNING_FROM_CHECKOUT=false
if [[ "$SCRIPT_DIR" == /dev/fd/* ]] || [[ "$SCRIPT_DIR" == /proc/self/fd/* ]] || [[ -z "${BASH_SOURCE[0]:-}" ]] || [[ "${BASH_SOURCE[0]:-}" == /dev/stdin ]]; then
  RUNNING_FROM_CHECKOUT=false
else
  if [[ "$(git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree 2>/dev/null || echo false)" == "true" ]]; then
    origin_url="$(git -C "$SCRIPT_DIR" remote get-url origin 2>/dev/null || true)"
    if [[ "$origin_url" == *turbopanel/turbopanel-dev* ]]; then
      RUNNING_FROM_CHECKOUT=true
      DEV_REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
      DEFAULT_ROOT="$(dirname "$DEV_REPO_ROOT")"
    fi
  fi
fi

resolve_install_root() {
  local input="$1"
  if [[ -z "$input" ]]; then
    input="~/turbopanel"
  fi
  input="${input/#\~/$HOME}"
  if command -v realpath >/dev/null 2>&1; then
    realpath --canonicalize-missing "$input"
  else
    mkdir -p "$input"
    (cd "$input" && pwd)
  fi
}

# Prompt for install location
if [[ "$RUNNING_FROM_CHECKOUT" == true ]]; then
  INSTALL_ROOT="$DEFAULT_ROOT"
  info "Running from a turbopanel-dev checkout — using install root: ${INSTALL_ROOT}"
elif [[ -n "${TURBOPANEL_INSTALL_ROOT:-}" ]]; then
  INSTALL_ROOT="$(resolve_install_root "$TURBOPANEL_INSTALL_ROOT")"
  info "Using install root from TURBOPANEL_INSTALL_ROOT: ${INSTALL_ROOT}"
elif [[ $# -gt 0 ]]; then
  INSTALL_ROOT="$(resolve_install_root "$1")"
  info "Using install root from argument: ${INSTALL_ROOT}"
elif [[ -r /dev/tty && -w /dev/tty ]]; then
  printf '%s' "Where would you like to install the TurboPanel directory? [default: ~/turbopanel]: " >/dev/tty
  read -r input </dev/tty || input=""
  INSTALL_ROOT="$(resolve_install_root "$input")"
else
  warn "No controlling terminal — using default install root: ~/turbopanel"
  INSTALL_ROOT="$(resolve_install_root "")"
fi

SKIPPED_REPOS=()

clone_or_update() {
  local repo_url="$1"
  local target_dir="$2"
  local branch="$3"
  local repo_name
  repo_name="$(basename "$target_dir")"

  if [[ ! -d "$target_dir" ]]; then
    git clone --branch "$branch" "$repo_url" "$target_dir"
    success "Cloned ${repo_name}"
    return
  fi

  if ! git -C "$target_dir" rev-parse --git-dir >/dev/null 2>&1; then
    error "${target_dir} exists but is not a git repository — skipping."
    return
  fi

  if [[ -n "$(git -C "$target_dir" status --porcelain)" ]]; then
    warn "${repo_name} has uncommitted changes — leaving untouched."
    SKIPPED_REPOS+=("$repo_name")
    return
  fi

  git -C "$target_dir" pull --ff-only origin "$branch"
  success "Updated ${repo_name}"
}

# Clone/update all repos
BRANCH="trunk"

mkdir -p "$INSTALL_ROOT"

if [[ "$RUNNING_FROM_CHECKOUT" != true ]]; then
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

if ((${#SKIPPED_REPOS[@]} > 0)); then
  warn "The following repos were skipped due to uncommitted changes:"
  for repo in "${SKIPPED_REPOS[@]}"; do
    echo "    - ${repo}"
  done
  echo
fi

info "Start local dev (Workers via pnpm/wrangler, proxied by Caddy):"
echo "  cd ${INSTALL_ROOT}/dev"
echo "  cp .env.example .env   # once"
echo "  tilt up"
echo

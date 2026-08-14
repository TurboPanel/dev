#!/bin/sh
# Boot the TurboPanel UTM guest (vagrant up) and land in the Ink console over SSH.
#
# Host prerequisites: Vagrant, UTM, vagrant_utm plugin; sibling repos next to this
# checkout (../turbopaneld, ../turbopanel, ../ui, ../website; ../.github is optional).
# Prefer SSH agent with a GitHub key loaded (agent is forwarded into the guest).
#
# Usage (from the dev repo root or any cwd):
#   ./scripts/vagrant-up.sh
#   sh scripts/vagrant-up.sh

set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"

if [ -t 1 ]; then
  _TP_RED=$(printf '\033[31m')
  _TP_YELLOW=$(printf '\033[33m')
  _TP_GREEN=$(printf '\033[32m')
  _TP_CYAN=$(printf '\033[36m')
  _TP_RESET=$(printf '\033[0m')
else
  _TP_RED=
  _TP_YELLOW=
  _TP_GREEN=
  _TP_CYAN=
  _TP_RESET=
fi

tp_info() {
  printf '%s→%s %s\n' "$_TP_CYAN" "$_TP_RESET" "$*"
}

tp_success() {
  printf '%s✓%s %s\n' "$_TP_GREEN" "$_TP_RESET" "$*"
}

tp_warn() {
  printf '%s⚠%s %s\n' "$_TP_YELLOW" "$_TP_RESET" "$*"
}

tp_error() {
  printf '%s✗%s %s\n' "$_TP_RED" "$_TP_RESET" "$*" >&2
}

require_vagrant() {
  if ! command -v vagrant >/dev/null 2>&1; then
    tp_error "vagrant is required on the host."
    echo "  Install: brew install hashicorp/tap/hashicorp-vagrant" >&2
    exit 1
  fi
}

require_utm_plugin() {
  if ! vagrant plugin list 2>/dev/null | grep -q '^vagrant_utm'; then
    tp_error "vagrant_utm plugin is not installed."
    echo "  Install: vagrant plugin install vagrant_utm" >&2
    echo "  Also install UTM: brew install --cask utm" >&2
    exit 1
  fi
}

warn_missing_ssh_agent() {
  if [ -z "${SSH_AUTH_SOCK:-}" ]; then
    tp_warn "SSH_AUTH_SOCK is unset; GitHub SSH from the guest may fail."
    tp_warn "Start an agent and add your key: eval \"\$(ssh-agent -s)\" && ssh-add"
    return 0
  fi
  if ! command -v ssh-add >/dev/null 2>&1; then
    return 0
  fi
  # ssh-add -l exits 1 when the agent has no identities, 2 when unreachable.
  if ! ssh-add -l >/dev/null 2>&1; then
    tp_warn "ssh-agent has no keys loaded; GitHub SSH from the guest may fail."
    tp_warn "Add a key: ssh-add --apple-use-keychain ~/.ssh/id_ed25519"
  fi
}

require_sibling_repos() {
  _missing=
  for _dir in turbopaneld turbopanel ui website; do
    if [ ! -d "$REPO_ROOT/../$_dir" ]; then
      _missing="${_missing} ../${_dir}"
    fi
  done
  if [ -n "$_missing" ]; then
    tp_error "Expected sibling checkout directories next to this repo:${_missing}"
    echo "  Layout: …/turbopanel/{dev,turbopaneld,turbopanel,ui,website}" >&2
    exit 1
  fi
  if [ ! -d "$REPO_ROOT/../.github" ]; then
    tp_warn "No ../.github sibling checkout — Ansible will clone it inside the guest instead."
  fi
}

require_vagrant
require_utm_plugin
require_sibling_repos
warn_missing_ssh_agent

if [ ! -f "$REPO_ROOT/Vagrantfile" ]; then
  tp_error "Vagrantfile not found at ${REPO_ROOT}/Vagrantfile"
  exit 1
fi

tp_info "Starting TurboPanel development VM (provider: utm)…"
vagrant up --provider=utm

tp_success "Guest ready — attaching to developer console"
# Force a TTY so Ink alternate-screen works over SSH.
exec vagrant ssh -- -t 'cd "$HOME/dev" && exec ./console'

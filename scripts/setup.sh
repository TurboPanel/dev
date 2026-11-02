#!/bin/sh
# One setup script for every TurboPanel contributor, maintainer or not.
#
#   ./scripts/setup.sh [setup] [--dir PATH] [--mode direct|vagrant] [--as-contributor] [--fork-all] [--yes] [--dry-run]
#   ./scripts/setup.sh fork REPO... [--dir PATH]   fork repos and point their checkouts at your forks
#   ./scripts/setup.sh doctor [--dir PATH]   read-only health report
#   ./scripts/setup.sh status [--dir PATH]   read-only one-row-per-repo summary
#
# setup puts the repos listed in repos.list into one folder (default: the folder
# named turbopanel that holds this dev checkout, else ./turbopanel), picks each
# repo's layout from your GitHub push access (without it you get a read-only
# clone of TurboPanel's repo; 'setup.sh fork <repo>' forks it when you are
# ready to push), and writes
# <folder>/.turbopanel-dev-mode. A missing GitHub CLI (gh) is installed from the
# official apt source on Debian or Ubuntu and 'gh auth login' is offered, each
# only after asking (--yes installs but never logs in). It then prints the plan
# before changing any repo and
# is safe to run again: existing checkouts are fetched, a clean checked-out trunk
# is fast-forwarded, and nothing is ever reset, stashed or switched.
#
# Test-only overrides (never needed by people):
#   TURBOPANEL_SETUP_REMOTE_BASE  clone from <base>/<owner>/<repo>.git instead of GitHub
#   TURBOPANEL_SETUP_OS_RELEASE   os-release file to read (default /etc/os-release)
#   TURBOPANEL_SETUP_FORK_WAIT    seconds to wait for a new fork (default 60)
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)
DEV_CHECKOUT=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)

# shellcheck source=scripts/lib/privileges.sh
. "$SCRIPT_DIR/lib/privileges.sh"

TP_ORG=TurboPanel
MODE_FILE_NAME=.turbopanel-dev-mode
REPOS_LIST="$DEV_CHECKOUT/repos.list"
# The profile file the Vagrantfile provisioner writes marks the Vagrant guest
# (scripts/lib/paths.sh reads the same file). TURBOPANEL_VAGRANT_GUEST_MARKER
# exists only so tests can point it elsewhere.
VAGRANT_GUEST_MARKER=${TURBOPANEL_VAGRANT_GUEST_MARKER:-/etc/profile.d/turbopanel-vagrant.sh}
REMOTE_BASE=${TURBOPANEL_SETUP_REMOTE_BASE:-}
OS_RELEASE=${TURBOPANEL_SETUP_OS_RELEASE:-/etc/os-release}
FORK_WAIT=${TURBOPANEL_SETUP_FORK_WAIT:-60}
GIT_TERMINAL_PROMPT=0
export GIT_TERMINAL_PROMPT

COMMAND=setup
DIR=
MODE=
FORCE_FORK=0
FORK_ALL=0
FORK_REPOS=
ASSUME_YES=0
DRY_RUN=0

tp_usage() {
  cat <<'USAGE'
Usage: setup.sh [setup|doctor|status] [options]

Commands:
  setup        clone or update every repo, write the mode file (default)
  fork REPO... fork each named repo to your account and make the checkout push
               there (origin = your fork, upstream = TurboPanel); keeps branches
  doctor       read-only report: host, tools, login, remotes, signing, mode file
  status       read-only table: role, branch, ahead/behind trunk, changes, open PR

Options:
  --dir PATH             folder that holds the repos (default: the turbopanel
                         folder around this checkout, else ./turbopanel)
  --mode direct|vagrant  how you run the development environment
  --as-contributor       act as if you had no push access: read-only clones,
                         as an outside contributor gets them (add --fork-all
                         to fork at setup instead; --fork is the old name)
  --fork-all             during setup, fork every repo you cannot push to
                         (all but .github) instead of on first push
  --yes                  do not ask; needs --mode on a first run. Installs a
                         missing gh on Debian or Ubuntu, never runs gh auth login
  --dry-run              print the plan and stop
  -h, --help             show this help
USAGE
}

# True only when a terminal can really be opened: /dev/tty can carry rw bits
# without a controlling terminal behind it.
tp_has_tty() {
  [ -t 0 ] && return 0
  (: </dev/tty) 2>/dev/null
}

tp_die() {
  tp_error "$*"
  exit 1
}

# Single-quote a value for a shell-sourceable file.
tp_sq() {
  _sq_value=$1
  printf "'%s'" "$(printf '%s' "$_sq_value" | sed "s/'/'\\\\''/g")"
}

# ---------------------------------------------------------------- repos.list

tp_repo_names() {
  sed -e 's/#.*//' -e '/^[[:space:]]*$/d' "$REPOS_LIST" | awk '{print $1}'
}

tp_repo_branch() {
  _rb_name=$1
  _rb=$(sed -e 's/#.*//' "$REPOS_LIST" | awk -v n="$_rb_name" '$1 == n {print $2}')
  printf '%s' "${_rb:-trunk}"
}

# Mode file key for a repo: .github -> role_github.
tp_role_key() {
  _rk_repo=$1
  printf 'role_%s' "$(printf '%s' "$_rk_repo" | sed -e 's/^\.//' -e 's/[^A-Za-z0-9_]/_/g')"
}

# The same key without role_, for the ROLE_<suffix> shell variables.
tp_role_suffix() {
  _rsf_repo=$1
  _rsf_key=$(tp_role_key "$_rsf_repo")
  printf '%s' "${_rsf_key#role_}"
}

# ---------------------------------------------------------------- mode file

tp_mode_file() {
  printf '%s/%s' "$DIR" "$MODE_FILE_NAME"
}

# Read one key from the mode file without sourcing it.
tp_mode_get() {
  _mg_key=$1
  _mf=$(tp_mode_file)
  [ -f "$_mf" ] || return 0
  # Values are written by tp_sq, which turns ' into '\''; undo that here.
  sed -n "s/^${_mg_key}='\\(.*\\)'\$/\\1/p" "$_mf" | tail -n 1 | sed "s/'\\\\''/'/g"
}

# ---------------------------------------------------------------- folder

# Absolute path with . and .. resolved, also for folders that do not exist yet.
tp_abs_path() {
  _ap_path=$1
  case "$_ap_path" in
    /*) ;;
    *) _ap_path="$PWD/$_ap_path" ;;
  esac
  if [ -d "$_ap_path" ]; then
    (CDPATH='' cd -- "$_ap_path" && pwd)
    return 0
  fi
  _ap_base=$(basename "$_ap_path")
  _ap_parent=$(tp_abs_path "$(dirname "$_ap_path")")
  case "$_ap_base" in
    . | '') printf '%s' "$_ap_parent" ;;
    ..) dirname "$_ap_parent" ;;
    *) printf '%s/%s' "${_ap_parent%/}" "$_ap_base" ;;
  esac
}

tp_resolve_dir() {
  if [ -n "$DIR" ]; then
    DIR=$(tp_abs_path "$DIR")
  else
    _parent=$(dirname "$DEV_CHECKOUT")
    if [ -f "$_parent/$MODE_FILE_NAME" ] || [ "$(basename "$_parent")" = turbopanel ]; then
      DIR=$_parent
    elif [ -f "$VAGRANT_GUEST_MARKER" ]; then
      # The guest mounts the host repos at ~/turbopanel/<repo>; a dev checkout
      # anywhere else is an old guest that still mounts them at ~/<repo>.
      tp_die "this Vagrant guest still mounts the repos at ~/<repo>; they now belong at ~/turbopanel/<repo>. On the host, in the dev checkout, run: vagrant destroy -f && vagrant up (or vagrant reload --provision, then Developer > Reset development environment in the console)."
    else
      DIR="$(tp_abs_path "$PWD")/turbopanel"
      # Run from inside a dev checkout: put the folder next to it, not in it.
      case "$DIR/" in
        "$DEV_CHECKOUT"/*)
          _parent=$(dirname "$DEV_CHECKOUT")
          DIR="${_parent%/}/turbopanel"
          ;;
        *) ;;
      esac
    fi
  fi
  case "$DIR/" in
    "$DEV_CHECKOUT"/*) tp_die "${DIR} is inside the dev checkout ${DEV_CHECKOUT}; pick a folder outside it with --dir." ;;
    *) ;;
  esac
  # In the old home-folder layout ~/turbopanel is the control plane checkout;
  # cloning into it would nest a second set of repos inside a repo.
  if [ -e "$DIR/.git" ]; then
    tp_die "${DIR} is a git checkout, not the folder that holds the repos. If your repos sit directly in your home folder, move them into a folder named turbopanel first (cd ~ && mkdir tp-move && for r in dev turbopaneld turbopanel ui website .github; do [ ! -e \"\$r\" ] || mv \"\$r\" tp-move/; done && mv tp-move turbopanel), then rerun ~/turbopanel/dev/scripts/setup.sh."
  fi
}

# ---------------------------------------------------------------- host facts

HOST_KERNEL=
HOST_ARCH=
OS_ID=
OS_VERSION_ID=
OS_NAME=
VIRT=
CONTAINER=
DIRECT_OK=0
DIRECT_WHY=
VAGRANT_OK=0
VAGRANT_WHY=
PROVIDER=
PROVIDER_PLUGIN=

tp_os_value() {
  _ov_key=$1
  [ -r "$OS_RELEASE" ] || return 0
  sed -n "s/^${_ov_key}=//p" "$OS_RELEASE" | tail -n 1 | sed -e 's/^"//' -e 's/"$//'
}

tp_detect_host() {
  HOST_KERNEL=$(uname -s 2>/dev/null || echo unknown)
  HOST_ARCH=$(uname -m 2>/dev/null || echo unknown)
  if [ "$HOST_KERNEL" = Linux ]; then
    OS_ID=$(tp_os_value ID)
    OS_VERSION_ID=$(tp_os_value VERSION_ID)
    OS_NAME=$(tp_os_value PRETTY_NAME)
  elif [ "$HOST_KERNEL" = Darwin ]; then
    OS_ID=macos
    OS_VERSION_ID=$(sw_vers -productVersion 2>/dev/null || true)
    OS_NAME="macOS ${OS_VERSION_ID}"
  fi
  if command -v systemd-detect-virt >/dev/null 2>&1; then
    VIRT=$(systemd-detect-virt 2>/dev/null || true)
    CONTAINER=$(systemd-detect-virt --container 2>/dev/null || true)
  elif [ -f /.dockerenv ]; then
    CONTAINER=docker
  elif [ -f /run/.containerenv ]; then
    CONTAINER=podman
  fi
  [ "$CONTAINER" != none ] || CONTAINER=

  case "$HOST_KERNEL" in
    Darwin)
      VAGRANT_OK=1
      PROVIDER=utm
      PROVIDER_PLUGIN=vagrant_utm
      ;;
    Linux)
      VAGRANT_OK=1
      PROVIDER=libvirt
      PROVIDER_PLUGIN=vagrant-libvirt
      ;;
    *)
      VAGRANT_WHY="the Vagrantfile supports Linux (libvirt) and macOS (UTM) hosts only"
      ;;
  esac

  if [ "$HOST_KERNEL" = Darwin ]; then
    DIRECT_WHY="this is macOS; direct mode needs a Debian 13 machine, so use Vagrant (the macOS guest runs Debian 12 today)"
  elif [ "$HOST_KERNEL" != Linux ]; then
    DIRECT_WHY="direct mode needs Debian 13 (this host is ${HOST_KERNEL})"
  elif [ "$OS_ID" != debian ] || [ "$OS_VERSION_ID" != 13 ]; then
    DIRECT_WHY="direct mode needs Debian 13 (this host is ${OS_NAME:-${OS_ID:-unknown} ${OS_VERSION_ID}})"
  elif [ -n "$CONTAINER" ]; then
    DIRECT_WHY="this is a ${CONTAINER} container; Docker, swap and firewall setup need a full VM"
  else
    DIRECT_OK=1
  fi
}

# ---------------------------------------------------------------- GitHub

GH_LOGIN=
GH_OFFLINE=0
CLONE_PROTOCOL=https

# Lower-case owner/repo comparison (GitHub names are case-insensitive).
tp_same_slug() {
  _ss_a=$1
  _ss_b=$2
  _ss_a=$(printf '%s' "$_ss_a" | tr '[:upper:]' '[:lower:]')
  _ss_b=$(printf '%s' "$_ss_b" | tr '[:upper:]' '[:lower:]')
  [ "$_ss_a" = "$_ss_b" ]
}

# GH_LOGIN is empty only when gh has no token. With a token but no answer from
# GitHub (offline), the login and roles from the last run are kept.
tp_detect_login() {
  GH_LOGIN=
  GH_OFFLINE=0
  command -v gh >/dev/null 2>&1 || return 0
  gh auth token >/dev/null 2>&1 || return 0
  if GH_LOGIN=$(gh api user --jq .login 2>/dev/null) && [ -n "$GH_LOGIN" ]; then
    return 0
  fi
  GH_OFFLINE=1
  GH_LOGIN=$(tp_mode_get github_login)
  tp_warn "GitHub did not answer (offline?); keeping the login and roles from the last run${GH_LOGIN:+ (${GH_LOGIN})}."
}

tp_detect_protocol() {
  CLONE_PROTOCOL=https
  if [ -n "$GH_LOGIN" ]; then
    _proto=$(gh config get git_protocol -h github.com 2>/dev/null || true)
    if [ "$_proto" = ssh ]; then
      CLONE_PROTOCOL=ssh
      return 0
    fi
  fi
  # A url.<ssh>.insteadOf https://github.com/ rule sends https clones over SSH.
  if git config --get-regexp '^url\..*\.insteadof$' 2>/dev/null |
    awk '$2 ~ /^https:\/\/github\.com\/?$/ && ($1 ~ /git@github\.com/ || $1 ~ /^url\.ssh:/) {found=1} END {exit !found}'; then
    CLONE_PROTOCOL=ssh
  fi
}

# ---------------------------------------------------------------- GitHub CLI

# The GitHub CLI apt source and the primary keys that sign it, as published in
# https://github.com/cli/cli/blob/trunk/docs/install_linux.md. Fingerprints are
# pinned rather than the keyring checksum, which changes whenever a key rotates.
GH_APT_URL=https://cli.github.com/packages
GH_KEY_URL="${GH_APT_URL}/githubcli-archive-keyring.gpg"
GH_KEYRING=/etc/apt/keyrings/githubcli-archive-keyring.gpg
GH_APT_LIST=/etc/apt/sources.list.d/github-cli.list
GH_KEY_FINGERPRINTS="2C6106201985B60E6C7AC87323F3D4EA75716059 7F38BBB59D064DBCB3D84D725612B36462313325"
# 1 once setup has installed gh or run gh auth login before printing the plan.
GH_CHANGED=0

tp_have_gh() {
  command -v gh >/dev/null 2>&1
}

# Debian, Ubuntu and their derivatives with apt-get.
tp_gh_apt_host() {
  [ "$HOST_KERNEL" = Linux ] || return 1
  command -v apt-get >/dev/null 2>&1 || return 1
  case " ${OS_ID} $(tp_os_value ID_LIKE) " in
    *" debian "* | *" ubuntu "*) return 0 ;;
    *) return 1 ;;
  esac
}

tp_gh_missing_hint() {
  if [ "$HOST_KERNEL" = Darwin ]; then
    printf "install it with 'brew install gh' (or from https://cli.github.com)"
  else
    printf 'install it from https://cli.github.com'
  fi
}

tp_gh_fetch_key() {
  _gf_out=$1
  if command -v curl >/dev/null 2>&1; then
    # The key is served directly; refuse redirects and anything but HTTPS.
    curl --proto '=https' --tlsv1.2 -fsS -o "$_gf_out" "$GH_KEY_URL"
  else
    wget -q --https-only --max-redirect=0 -O "$_gf_out" "$GH_KEY_URL"
  fi
}

# True only when the downloaded keyring is public keys alone, holds at least one
# primary key, every primary key has its fingerprint line and every one of those
# is a published fingerprint. Fails closed: any record a public key listing does
# not carry (a secret key lists as sec/ssb) rejects the whole file. Uses a
# throwaway GNUPGHOME so the user's own keyring is never read or written.
tp_gh_key_ok() {
  _gk_dir=$1
  mkdir -m 700 "$_gk_dir/gnupg" || return 1
  _gk_fprs=$(GNUPGHOME="$_gk_dir/gnupg" gpg --batch --show-keys --with-colons "$_gk_dir/keyring.gpg" 2>/dev/null |
    awk -F: '
      $1 !~ /^(pub|sub|fpr|fp2|grp|uid|uat|sig|rev|rvk|rvs|spk|tru|cfg)$/ {bad = 1}
      $1 == "pub" {pubs++; want = 1; next}
      want && $1 == "fpr" && $10 != "" {print $10; fprs++}
      {want = 0}
      END {if (bad || pubs == 0 || pubs != fprs) exit 1}') || {
    tp_error "the GitHub CLI keyring is not a plain set of public keys with fingerprints."
    return 1
  }
  for _gk_fpr in $_gk_fprs; do
    case " ${GH_KEY_FINGERPRINTS} " in
      *" ${_gk_fpr} "*) ;;
      *)
        tp_error "unexpected GitHub CLI signing key ${_gk_fpr}."
        return 1
        ;;
    esac
  done
}

# The official apt steps: fetch the keyring, check its fingerprints, add the
# signed-by source, install gh. Asks for the sudo password through sudo itself.
tp_install_gh_apt() {
  if ! command -v sudo >/dev/null 2>&1; then
    tp_error "sudo is required to install gh."
    return 1
  fi
  tp_info "Installing the GitHub CLI from ${GH_APT_URL} (asks for your sudo password)"
  _ig_need=
  command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || _ig_need=curl
  command -v gpg >/dev/null 2>&1 || _ig_need="${_ig_need:+${_ig_need} }gnupg"
  # shellcheck disable=SC2086 # a space-separated list of package names
  if [ -n "$_ig_need" ] && ! { sudo apt-get update && sudo apt-get install -y $_ig_need; }; then
    tp_error "could not install ${_ig_need}, needed to check the GitHub CLI signing key."
    return 1
  fi
  _ig_dir=$(mktemp -d) || return 1
  # tp_cleanup removes CURRENT_TMP, also on an early exit or Ctrl-C.
  CURRENT_TMP=$_ig_dir
  trap tp_cleanup EXIT
  trap 'tp_cleanup; exit 130' INT TERM
  _ig_ok=0
  if tp_install_gh_from "$_ig_dir"; then
    _ig_ok=1
  fi
  tp_cleanup
  CURRENT_TMP=
  [ "$_ig_ok" -eq 1 ]
}

tp_install_gh_from() {
  _if_dir=$1
  if ! tp_gh_fetch_key "$_if_dir/keyring.gpg"; then
    tp_error "could not download ${GH_KEY_URL}."
    return 1
  fi
  if ! tp_gh_key_ok "$_if_dir"; then
    tp_error "the GitHub CLI signing key does not match the published fingerprints; nothing was installed."
    return 1
  fi
  _if_arch=$(dpkg --print-architecture 2>/dev/null || true)
  if [ -z "$_if_arch" ]; then
    tp_error "dpkg did not report this machine's architecture; nothing was installed."
    return 1
  fi
  if sudo install -d -m 0755 /etc/apt/keyrings &&
    sudo install -m 0644 "$_if_dir/keyring.gpg" "$GH_KEYRING" &&
    printf 'deb [arch=%s signed-by=%s] %s stable main\n' "$_if_arch" "$GH_KEYRING" "$GH_APT_URL" |
    sudo tee "$GH_APT_LIST" >/dev/null &&
    sudo apt-get update &&
    sudo apt-get install -y gh; then
    return 0
  fi
  tp_error "installing gh with apt failed."
  return 1
}

# Offer to install gh when it is missing: asks first, installs without asking
# under --yes, and only warns when there is no terminal and no --yes.
tp_ensure_gh() {
  tp_have_gh && return 0
  if ! tp_gh_apt_host; then
    tp_warn "The GitHub CLI (gh) is not installed; cloning read-only. Setup installs it only on Debian or Ubuntu; $(tp_gh_missing_hint) to open pull requests."
    return 0
  fi
  if [ "$ASSUME_YES" -eq 0 ]; then
    if ! tp_has_tty; then
      tp_warn "The GitHub CLI (gh) is not installed; cloning read-only. Rerun in a terminal or with --yes to install it, or $(tp_gh_missing_hint)."
      return 0
    fi
    if ! tp_read_tty_yn "The GitHub CLI (gh) is not installed. Install it from the official GitHub CLI apt source (uses sudo)?" y; then
      tp_warn "Skipped installing gh; cloning read-only. $(tp_gh_missing_hint) to open pull requests."
      return 0
    fi
  fi
  GH_CHANGED=1
  if tp_install_gh_apt && tp_have_gh; then
    tp_success "Installed $(gh --version 2>/dev/null | head -n 1)"
  else
    tp_warn "gh is still not installed; cloning read-only. $(tp_gh_missing_hint), then rerun setup."
  fi
}

# The login command setup runs and tells people to run themselves: the
# browser (device code) flow with every question answered by flags.
TP_GH_LOGIN_CMD='gh auth login --hostname github.com --git-protocol https --web'

tp_gh_login_hint() {
  echo "  To log in yourself, run this in a plain SSH terminal, then rerun this script:"
  echo "    ${TP_GH_LOGIN_CMD}"
}

# Offer 'gh auth login' on a terminal. The user signs in through gh itself;
# setup never types, reads or passes a token or password. Never under --yes.
# gh's menus fail on terminals that answer its colour query late ("could not
# prompt: unexpected escape sequence from terminal"), so every question is a
# flag and GH_PROMPT_DISABLED keeps gh from asking any: it prints a one-time
# code and https://github.com/login/device and waits. A failed or cancelled
# login never stops setup.
tp_offer_gh_login() {
  tp_have_gh || return 0
  if gh auth token >/dev/null 2>&1; then
    return 0
  fi
  [ "$ASSUME_YES" -eq 0 ] || return 0
  tp_has_tty || return 0
  if ! tp_read_tty_yn "You are not logged in to GitHub. Log in now (gh shows a one-time code to enter at https://github.com/login/device)?" y; then
    tp_gh_login_hint
    return 0
  fi
  GH_CHANGED=1
  _gl_proto=https
  _gl_ssh=
  if [ "$(gh config get git_protocol -h github.com 2>/dev/null || true)" = ssh ]; then
    # Keep an ssh choice made before; never generate or upload a key here.
    _gl_proto=ssh
    _gl_ssh=1
  fi
  if ! GH_PROMPT_DISABLED=1 gh auth login --hostname github.com --git-protocol "$_gl_proto" --web ${_gl_ssh:+"--skip-ssh-key"} </dev/tty >/dev/tty 2>&1; then
    tp_warn "gh auth login did not finish; setup goes on with read-only clones."
    tp_gh_login_hint
  fi
}

# Plan lines for the GitHub CLI steps a real run would offer (dry run only).
tp_gh_plan() {
  if ! tp_have_gh; then
    if ! tp_gh_apt_host; then
      echo "  GitHub CLI:   not installed; $(tp_gh_missing_hint)"
      return 0
    fi
    if [ "$ASSUME_YES" -eq 1 ]; then
      echo "  GitHub CLI:   install gh from the official apt source ${GH_APT_URL} (signing key fingerprints checked; sudo)"
    else
      echo "  GitHub CLI:   offer to install gh from the official apt source ${GH_APT_URL} (asks first; signing key fingerprints checked; sudo)"
    fi
  fi
  if [ -z "$GH_LOGIN" ]; then
    if [ "$ASSUME_YES" -eq 1 ]; then
      echo "  GitHub login: not logged in; --yes never runs 'gh auth login', run it yourself: ${TP_GH_LOGIN_CMD}"
    else
      echo "  GitHub login: offer 'gh auth login' (asks first; you sign in yourself with a one-time code)"
    fi
  fi
}

tp_url() {
  _url_owner=$1
  _url_repo=$2
  if [ -n "$REMOTE_BASE" ]; then
    printf '%s/%s/%s.git' "$REMOTE_BASE" "$_url_owner" "$_url_repo"
  elif [ "$CLONE_PROTOCOL" = ssh ] && [ -n "$GH_LOGIN" ]; then
    printf 'git@github.com:%s/%s.git' "$_url_owner" "$_url_repo"
  else
    printf 'https://github.com/%s/%s.git' "$_url_owner" "$_url_repo"
  fi
}

# owner/repo from any remote URL form.
tp_url_slug() {
  _us_url=$1
  # Only GitHub (or the test-only remote base) names a GitHub repo; another
  # host with the same owner/repo path is not TurboPanel's.
  case "$_us_url" in
    https://github.com/* | git@github.com:* | ssh://git@github.com/* | ssh://github.com/*)
      _us_path=${_us_url#*github.com}
      _us_path=${_us_path#[:/]}
      ;;
    *)
      _us_path=
      if [ -n "$REMOTE_BASE" ]; then
        case "$_us_url" in
          "$REMOTE_BASE"/*) _us_path=${_us_url#"$REMOTE_BASE"/} ;;
          *) ;;
        esac
      fi
      ;;
  esac
  [ -n "$_us_path" ] || return 0
  printf '%s' "$_us_path" | sed -e 's#\.git$##' -e 's#/*$##' | awk -F/ 'NF == 2 {print $1 "/" $2}'
}

tp_remote_slug() {
  _rs_path=$1
  _rs_remote=$2
  _ru=$(git -C "$_rs_path" remote get-url "$_rs_remote" 2>/dev/null) || return 0
  tp_url_slug "$_ru"
}

tp_has_remote() {
  _hr_path=$1
  _hr_remote=$2
  git -C "$_hr_path" remote get-url "$_hr_remote" >/dev/null 2>&1
}

# maintainer: push access, origin = TurboPanel repo, no upstream.
# contributor: no push access (or --as-contributor), a read-only clone: origin = TurboPanel.
# contributor-fork: forked (setup.sh fork, or --fork-all): origin = your fork,
#   upstream = TurboPanel.
# readonly: not logged in (or the .github repo without push access); origin = TurboPanel.
tp_detect_role() {
  _dr_repo=$1
  _dr_prev=$(tp_mode_get "$(tp_role_key "$_dr_repo")")
  if [ -z "$GH_LOGIN" ]; then
    printf readonly
    return 0
  fi
  if [ "$GH_OFFLINE" -eq 1 ] || ! _dr_push=$(gh api "repos/${TP_ORG}/${_dr_repo}" --jq .permissions.push 2>/dev/null); then
    # Offline or an API error: keep what the last run recorded.
    printf '%s' "${_dr_prev:-readonly}"
    return 0
  fi
  case "$_dr_push" in
    true | false) ;;
    *)
      # No permissions in the answer: never fork on an unclear answer.
      tp_warn "${_dr_repo}: GitHub did not say whether you can push; keeping ${_dr_prev:-readonly}." >&2
      printf '%s' "${_dr_prev:-readonly}"
      return 0
      ;;
  esac
  if [ "$_dr_push" = true ] && [ "$FORCE_FORK" -eq 0 ]; then
    printf maintainer
  elif [ "$_dr_repo" = .github ]; then
    # A fork of an org's .github repo becomes your own account-wide community
    # health repo, so it is never forked for you: only 'setup.sh fork .github'.
    printf readonly
  elif [ "$FORK_ALL" -eq 1 ]; then
    printf contributor-fork
  else
    # No push access: a read-only clone until 'setup.sh fork <repo>'.
    printf contributor
  fi
}

tp_slug_url() {
  _su_slug=$1
  tp_url "${_su_slug%%/*}" "${_su_slug#*/}"
}

# The user's fork of TurboPanel/<repo>, whatever it is called: <login>/<repo>
# first, then the fork list filtered by owner (a fork can be renamed).
tp_find_fork() {
  _fk_repo=$1
  _fk_parent=$(gh api "repos/${GH_LOGIN}/${_fk_repo}" --jq '.parent.full_name // ""' 2>/dev/null || true)
  if tp_same_slug "$_fk_parent" "${TP_ORG}/${_fk_repo}"; then
    printf '%s/%s' "$GH_LOGIN" "$_fk_repo"
    return 0
  fi
  gh api --paginate "repos/${TP_ORG}/${_fk_repo}/forks?per_page=100" \
    --jq ".[] | select((.owner.login | ascii_downcase) == (\"${GH_LOGIN}\" | ascii_downcase)) | .full_name" \
    2>/dev/null | head -n 1
}

# Set EF_SLUG to the user's fork of TurboPanel/<repo>, creating it if needed.
# Only provable against real GitHub: the fork call is asynchronous, so poll for
# at most TURBOPANEL_SETUP_FORK_WAIT seconds; a rerun finds a late fork.
tp_ensure_fork() {
  _ef_repo=$1
  EF_SLUG=$(tp_find_fork "$_ef_repo")
  [ -z "$EF_SLUG" ] || return 0
  if ! (cd / && gh repo fork "${TP_ORG}/${_ef_repo}" --clone=false >/dev/null 2>&1); then
    tp_error "could not fork ${TP_ORG}/${_ef_repo} (gh repo fork failed)."
    return 1
  fi
  _ef_waited=0
  while [ "$_ef_waited" -le "$FORK_WAIT" ]; do
    EF_SLUG=$(tp_find_fork "$_ef_repo")
    if [ -n "$EF_SLUG" ] && git ls-remote "$(tp_slug_url "$EF_SLUG")" HEAD >/dev/null 2>&1; then
      return 0
    fi
    [ "$_ef_waited" -lt "$FORK_WAIT" ] || break
    sleep 2
    _ef_waited=$((_ef_waited + 2))
  done
  EF_SLUG=
  tp_error "your fork of ${TP_ORG}/${_ef_repo} was not ready within ${FORK_WAIT}s; GitHub may still be copying it. Rerun later (setup.sh fork ${_ef_repo}, or setup with --fork-all)."
  return 1
}

# ---------------------------------------------------------------- repo facts

tp_is_checkout() {
  _ic_path=$1
  [ -d "$_ic_path" ] && git -C "$_ic_path" rev-parse --is-inside-work-tree >/dev/null 2>&1 &&
    [ "$(git -C "$_ic_path" rev-parse --show-toplevel 2>/dev/null)" = "$(CDPATH='' cd -- "$_ic_path" && pwd -P)" ]
}

tp_base_remote() {
  _br_path=$1
  if tp_has_remote "$_br_path" upstream; then
    printf upstream
  else
    printf origin
  fi
}

tp_current_branch() {
  _cb_path=$1
  git -C "$_cb_path" symbolic-ref --short -q HEAD 2>/dev/null || printf '(detached)'
}

tp_dirty_count() {
  _dc_path=$1
  git --no-optional-locks -C "$_dc_path" status --porcelain 2>/dev/null | wc -l | tr -d ' '
}

# "+ahead -behind" of HEAD against <base>/<branch>, or "?" without that ref.
tp_ahead_behind() {
  _ab_path=$1
  _ab_remote=$2
  _ab_branch=$3
  _ab_ref="refs/remotes/${_ab_remote}/${_ab_branch}"
  if ! git -C "$_ab_path" rev-parse -q --verify "${_ab_ref}^{commit}" >/dev/null 2>&1; then
    printf '?'
    return 0
  fi
  git -C "$_ab_path" rev-list --left-right --count "HEAD...${_ab_ref}" 2>/dev/null |
    awk '{printf "+%s -%s", $1, $2}'
}

# True when the checkout pushes to a fork: upstream = TurboPanel, origin elsewhere.
tp_fork_shaped() {
  _fs_path=$1
  _fs_name=$2
  _fs_origin=$(tp_remote_slug "$_fs_path" origin)
  [ -n "$_fs_origin" ] &&
    tp_same_slug "$(tp_remote_slug "$_fs_path" upstream)" "${TP_ORG}/${_fs_name}" &&
    ! tp_same_slug "$_fs_origin" "${TP_ORG}/${_fs_name}"
}

# Role of a checkout: a fork-shaped layout wins (mode files written before
# fork-on-first-push said contributor for a fork), else the mode file.
tp_layout_role() {
  _lr_path=$1
  _lr_name=$2
  _lr=$(tp_mode_get "$(tp_role_key "$_lr_name")")
  if tp_fork_shaped "$_lr_path" "$_lr_name"; then
    printf contributor-fork
  elif [ -n "$_lr" ]; then
    printf '%s' "$_lr"
  else
    printf unknown
  fi
}

# Short words for a role in tables: read-only clone versus forked.
tp_role_word() {
  _rw_role=$1
  case "$_rw_role" in
    contributor | readonly) printf read-only ;;
    contributor-fork) printf forked ;;
    *) printf '%s' "$_rw_role" ;;
  esac
}

# ---------------------------------------------------------------- setup steps

FAILED=
CURRENT_TMP=

tp_cleanup() {
  if [ -n "$CURRENT_TMP" ] && [ -d "$CURRENT_TMP" ]; then
    rm -rf "$CURRENT_TMP"
  fi
}

tp_fail_repo() {
  _fr_name=$1
  _fr_why=$2
  FAILED="${FAILED} ${_fr_name}"
  tp_error "${_fr_name}: ${_fr_why}"
}

tp_fetch() {
  _fe_path=$1
  _fe_remote=$2
  _fe_name=$3
  if ! git -C "$_fe_path" fetch --quiet --prune "$_fe_remote" 2>/dev/null; then
    tp_warn "${_fe_name}: could not fetch ${_fe_remote} (offline?); using what is already here."
  fi
}

# Fast-forward the default branch to <base>/<branch>: only when it is checked
# out and clean, or not checked out at all. Never resets, stashes or switches.
tp_fast_forward() {
  _ff_path=$1
  _ff_name=$2
  _ff_branch=$3
  _ff_base=$(tp_base_remote "$_ff_path")
  _ff_ref="refs/remotes/${_ff_base}/${_ff_branch}"
  git -C "$_ff_path" rev-parse -q --verify "${_ff_ref}^{commit}" >/dev/null 2>&1 || return 0
  if [ "$(tp_current_branch "$_ff_path")" = "$_ff_branch" ]; then
    if [ "$(tp_dirty_count "$_ff_path")" -ne 0 ]; then
      tp_warn "${_ff_name}: ${_ff_branch} has local changes; left as it is."
    elif ! git -C "$_ff_path" merge --ff-only --quiet "$_ff_ref" >/dev/null 2>&1; then
      tp_warn "${_ff_name}: ${_ff_branch} has commits that are not on ${_ff_base}; left as it is."
    fi
  elif git -C "$_ff_path" worktree list --porcelain 2>/dev/null | grep -qxF "branch refs/heads/${_ff_branch}"; then
    tp_warn "${_ff_name}: ${_ff_branch} is checked out in another worktree; left as it is."
  elif git -C "$_ff_path" rev-parse -q --verify "refs/heads/${_ff_branch}" >/dev/null 2>&1 &&
    git -C "$_ff_path" merge-base --is-ancestor "refs/heads/${_ff_branch}" "$_ff_ref" 2>/dev/null; then
    # A fetch from . refuses a branch checked out anywhere and only fast-forwards.
    git -C "$_ff_path" fetch --quiet . "${_ff_ref}:refs/heads/${_ff_branch}" 2>/dev/null ||
      tp_warn "${_ff_name}: could not fast-forward ${_ff_branch}; left as it is."
  fi
}

tp_clone_new() {
  _cn_name=$1
  _cn_branch=$2
  _cn_role=$3
  _cn_fork=$4
  _cn_path="$DIR/$_cn_name"
  _cn_canon=$(tp_url "$TP_ORG" "$_cn_name")
  _cn_origin=$_cn_canon
  if [ "$_cn_role" = contributor-fork ]; then
    _cn_origin=$(tp_slug_url "$_cn_fork")
  fi
  CURRENT_TMP="$DIR/.setup-clone-${_cn_name}"
  rm -rf "$CURRENT_TMP"
  tp_info "${_cn_name}: cloning $(tp_url_slug "$_cn_origin")"
  if ! git clone --quiet "$_cn_origin" "$CURRENT_TMP" 2>/dev/null; then
    tp_cleanup
    CURRENT_TMP=
    tp_fail_repo "$_cn_name" "clone failed (offline, or no access to $(tp_url_slug "$_cn_origin"))"
    return 0
  fi
  if [ "$_cn_role" = contributor-fork ]; then
    git -C "$CURRENT_TMP" remote add upstream "$_cn_canon"
    tp_fetch "$CURRENT_TMP" upstream "$_cn_name"
    if git -C "$CURRENT_TMP" rev-parse -q --verify "refs/remotes/upstream/${_cn_branch}" >/dev/null 2>&1 &&
      [ "$(tp_current_branch "$CURRENT_TMP")" = "$_cn_branch" ]; then
      git -C "$CURRENT_TMP" merge --ff-only --quiet "upstream/${_cn_branch}" >/dev/null 2>&1 || true
      git -C "$CURRENT_TMP" branch --quiet --set-upstream-to="upstream/${_cn_branch}" "$_cn_branch" >/dev/null 2>&1 || true
    fi
  fi
  mv "$CURRENT_TMP" "$_cn_path"
  CURRENT_TMP=
}

# Bring an existing checkout's remotes in line with the role. Prints the role
# the layout really has afterwards.
tp_reconcile_remotes() {
  _rr_path=$1
  _rr_name=$2
  _rr_role=$3
  _rr_fork=$4
  _rr_canon_slug="${TP_ORG}/${_rr_name}"
  _rr_origin=$(tp_remote_slug "$_rr_path" origin)
  _rr_upstream=$(tp_remote_slug "$_rr_path" upstream)
  if tp_same_slug "$_rr_upstream" "$_rr_canon_slug" && ! tp_same_slug "$_rr_origin" "$_rr_canon_slug"; then
    # Already fork-shaped; keep it even for a maintainer.
    printf contributor-fork
    return 0
  fi
  if [ "$_rr_role" = contributor-fork ] && [ -n "$_rr_fork" ] && [ -z "$_rr_upstream" ]; then
    if tp_same_slug "$_rr_origin" "$_rr_canon_slug"; then
      tp_info "${_rr_name}: origin becomes your fork ${_rr_fork}; ${_rr_canon_slug} becomes upstream" >&2
      git -C "$_rr_path" remote rename origin upstream
      git -C "$_rr_path" remote add origin "$(tp_slug_url "$_rr_fork")"
      printf contributor-fork
      return 0
    fi
    if tp_same_slug "$_rr_origin" "$_rr_fork"; then
      git -C "$_rr_path" remote add upstream "$(tp_url "$TP_ORG" "$_rr_name")"
      printf contributor-fork
      return 0
    fi
  fi
  if [ -n "$_rr_origin" ] && ! tp_same_slug "$_rr_origin" "$_rr_canon_slug" &&
    ! tp_same_slug "$_rr_origin" "${_rr_fork:-?}"; then
    tp_warn "${_rr_name}: origin points to ${_rr_origin}; left as it is." >&2
  fi
  printf '%s' "$_rr_role"
}

tp_sync_repo() {
  _sr_name=$1
  _sr_branch=$2
  _sr_role=$3
  _sr_path="$DIR/$_sr_name"
  _sr_fork=
  if [ "$_sr_role" = contributor-fork ]; then
    _sr_origin=$(tp_remote_slug "$_sr_path" origin)
    if tp_is_checkout "$_sr_path" && [ -n "$_sr_origin" ] &&
      ! tp_same_slug "$_sr_origin" "${TP_ORG}/${_sr_name}" &&
      { tp_same_slug "$(tp_remote_slug "$_sr_path" upstream)" "${TP_ORG}/${_sr_name}" ||
        tp_same_slug "${_sr_origin%%/*}" "$GH_LOGIN"; }; then
      # The checkout already points at your fork: no GitHub call needed.
      _sr_fork=$_sr_origin
    elif [ "$GH_OFFLINE" -eq 1 ]; then
      tp_fail_repo "$_sr_name" "GitHub did not answer, so your fork cannot be looked up; rerun when online"
      return 0
    elif tp_ensure_fork "$_sr_name"; then
      _sr_fork=$EF_SLUG
    else
      tp_fail_repo "$_sr_name" "no fork to work from"
      return 0
    fi
  fi
  if [ ! -e "$_sr_path" ]; then
    tp_clone_new "$_sr_name" "$_sr_branch" "$_sr_role" "$_sr_fork"
    [ -d "$_sr_path" ] || return 0
  elif ! tp_is_checkout "$_sr_path"; then
    tp_fail_repo "$_sr_name" "${_sr_path} exists but is not a git checkout; left alone"
    return 0
  else
    _sr_role=$(tp_reconcile_remotes "$_sr_path" "$_sr_name" "$_sr_role" "$_sr_fork")
    tp_fetch "$_sr_path" origin "$_sr_name"
    if tp_has_remote "$_sr_path" upstream; then
      tp_fetch "$_sr_path" upstream "$_sr_name"
    fi
    tp_fast_forward "$_sr_path" "$_sr_name" "$_sr_branch"
  fi
  if [ -f "$_sr_path/.githooks/pre-commit" ]; then
    _sr_hooks=$(git -C "$_sr_path" config --local --get core.hooksPath 2>/dev/null || true)
    if [ -z "$_sr_hooks" ]; then
      git -C "$_sr_path" config core.hooksPath .githooks
    elif [ "$_sr_hooks" != .githooks ]; then
      tp_warn "${_sr_name}: core.hooksPath is ${_sr_hooks}, not .githooks; left as it is (git -C $(tp_sq "$_sr_path") config core.hooksPath .githooks)."
    fi
  fi
  eval "ROLE_$(tp_role_suffix "$_sr_name")=\$_sr_role"
  [ "$_sr_role" != contributor-fork ] || tp_set_gh_default "$_sr_name"
}

tp_write_mode_file() {
  _wm_file=$(tp_mode_file)
  _wm_created=$(tp_mode_get created)
  _wm_now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  [ -n "$_wm_created" ] || _wm_created=$_wm_now
  _wm_tmp="${_wm_file}.tmp"
  {
    echo "# TurboPanel development setup, written by dev/scripts/setup.sh. Safe to source."
    echo "# dev_root is the folder that holds the repos on the machine where you edit."
    if [ "$MODE" = vagrant ]; then
      echo "# In the Vagrant guest the same repos are mounted at ~/turbopanel/<repo>."
    fi
    echo "TURBOPANEL_DEV_ENV=$(tp_sq "$MODE")"
    echo "dev_root=$(tp_sq "$DIR")"
    echo "clone_protocol=$(tp_sq "$CLONE_PROTOCOL")"
    echo "github_login=$(tp_sq "$GH_LOGIN")"
    for _wm_repo in $(tp_repo_names); do
      _wm_key=$(tp_role_key "$_wm_repo")
      eval "_wm_role=\${ROLE_${_wm_key#role_}:-}"
      [ -n "$_wm_role" ] || _wm_role=$(tp_mode_get "$_wm_key")
      echo "${_wm_key}=$(tp_sq "${_wm_role:-unknown}")"
    done
    echo "created=$(tp_sq "$_wm_created")"
    echo "updated=$(tp_sq "$_wm_now")"
  } >"$_wm_tmp"
  mv "$_wm_tmp" "$_wm_file"
}

tp_choose_mode() {
  [ -n "$MODE" ] || MODE=$(tp_mode_get TURBOPANEL_DEV_ENV)
  if [ -z "$MODE" ]; then
    if [ "$DIRECT_OK" -eq 0 ] && [ "$VAGRANT_OK" -eq 1 ]; then
      tp_info "Direct mode is not offered: ${DIRECT_WHY}."
      MODE=vagrant
    elif [ "$DRY_RUN" -eq 1 ]; then
      MODE=
    elif [ "$ASSUME_YES" -eq 1 ]; then
      tp_die "--yes needs --mode direct or --mode vagrant on a first run."
    elif ! tp_has_tty; then
      tp_die "no terminal to ask on; pass --yes --mode direct|vagrant."
    else
      _cm_hint=
      if [ -n "$VIRT" ] && [ "$VIRT" != none ]; then
        _cm_hint=" (recommended: this machine is already a ${VIRT} VM)"
      fi
      printf 'How do you want to run TurboPanel?\n  1) Vagrant: the repos stay in %s on this machine; '"'"'vagrant up'"'"' in %s/dev runs them in a Debian VM\n  2) Direct: this Debian 13 machine becomes the dev machine; setup gives your user passwordless sudo%s\nChoose 1 or 2: ' "$DIR" "$DIR" "$_cm_hint" >/dev/tty
      IFS= read -r _cm_answer </dev/tty || _cm_answer=
      case "$(tp_trim_whitespace "$(tp_strip_terminal_replies "$_cm_answer")")" in
        1 | vagrant) MODE=vagrant ;;
        2 | direct) MODE=direct ;;
        *) tp_die "no choice made; rerun and pick 1 or 2, or pass --mode." ;;
      esac
    fi
  fi
  case "$MODE" in
    '') ;;
    direct)
      [ "$DIRECT_OK" -eq 1 ] || tp_die "direct mode is not available: ${DIRECT_WHY}."
      # The console, vm-bootstrap.sh and the dev playbook refuse any other
      # folder name.
      if [ "${DIR##*/}" != turbopanel ]; then
        tp_die "direct mode keeps the repos in a folder named turbopanel (e.g. ~/turbopanel/<repo>), not ${DIR}; rerun with --dir \"\$HOME/turbopanel\" or another folder named turbopanel."
      fi
      ;;
    vagrant)
      [ "$VAGRANT_OK" -eq 1 ] || tp_die "Vagrant mode is not available: ${VAGRANT_WHY}."
      ;;
    *) tp_die "unknown mode ${MODE}; use direct or vagrant." ;;
  esac
}

tp_vagrant_hints() {
  if ! command -v vagrant >/dev/null 2>&1; then
    tp_warn "Vagrant is not installed. Install it before 'vagrant up':"
    if [ "$HOST_KERNEL" = Darwin ]; then
      echo "    brew install hashicorp/tap/hashicorp-vagrant && brew install --cask utm"
    else
      echo "    see https://developer.hashicorp.com/vagrant/install, then install libvirt"
    fi
    echo "    vagrant plugin install ${PROVIDER_PLUGIN}"
    return 0
  fi
  if ! vagrant plugin list 2>/dev/null | grep -q "^${PROVIDER_PLUGIN}"; then
    tp_warn "Vagrant plugin ${PROVIDER_PLUGIN} is missing: vagrant plugin install ${PROVIDER_PLUGIN}"
  fi
  if [ "$HOST_KERNEL" = Linux ] && [ ! -e /dev/kvm ]; then
    tp_warn "/dev/kvm is missing; the guest will be very slow without hardware virtualization."
  fi
}

tp_direct_bootstrap() {
  _db_user=$(id -un)
  _db_script="$DIR/dev/scripts/vm-bootstrap.sh"
  [ -f "$_db_script" ] || _db_script="$SCRIPT_DIR/vm-bootstrap.sh"
  if [ -f /etc/profile.d/turbopanel-dev.sh ] && sudo -n true >/dev/null 2>&1; then
    tp_info "This machine is already prepared (passwordless sudo and /etc/profile.d/turbopanel-dev.sh)."
    tp_info "To redo it: sudo env TURBOPANEL_DEV_ROOT=$(tp_sq "$DIR") sh $(tp_sq "$_db_script") ${_db_user}"
    return 0
  fi
  tp_info "Preparing this machine as root (asks for your sudo password once)"
  if ! sudo env "TURBOPANEL_DEV_ROOT=$DIR" sh "$_db_script" "$_db_user"; then
    tp_error "vm-bootstrap.sh failed; fix the error above and rerun setup."
    FAILED="${FAILED} (direct-mode bootstrap)"
  fi
}

tp_print_rows() {
  _pr_with_pr=$1
  if [ "$_pr_with_pr" -eq 1 ]; then
    printf '%-12s %-12s %-28s %-12s %-6s %s\n' REPO ROLE BRANCH "VS TRUNK" DIRTY PR
  else
    printf '%-12s %-12s %-28s %-12s %s\n' REPO ROLE BRANCH "VS TRUNK" DIRTY
  fi
  for _pr_name in $(tp_repo_names); do
    _pr_path="$DIR/$_pr_name"
    if ! tp_is_checkout "$_pr_path"; then
      printf '%-12s %s\n' "$_pr_name" "missing (run setup)"
      continue
    fi
    _pr_default=$(tp_repo_branch "$_pr_name")
    _pr_role=$(tp_layout_role "$_pr_path" "$_pr_name")
    _pr_branch=$(tp_current_branch "$_pr_path")
    _pr_vs=$(tp_ahead_behind "$_pr_path" "$(tp_base_remote "$_pr_path")" "$_pr_default")
    _pr_dirty=$(tp_dirty_count "$_pr_path")
    if [ "$_pr_with_pr" -eq 1 ]; then
      _pr_pr=-
      if [ -n "$GH_LOGIN" ] && [ "$_pr_branch" != "$_pr_default" ] && [ "$_pr_branch" != '(detached)' ]; then
        _pr_num=$(gh pr list -R "${TP_ORG}/${_pr_name}" --head "$_pr_branch" --state open \
          --json number --jq '.[0].number // ""' 2>/dev/null || true)
        [ -z "$_pr_num" ] || _pr_pr="#${_pr_num}"
      fi
      printf '%-12s %-12s %-28s %-12s %-6s %s\n' "$_pr_name" "$(tp_role_word "$_pr_role")" "$_pr_branch" "$_pr_vs" "$_pr_dirty" "$_pr_pr"
    else
      printf '%-12s %-12s %-28s %-12s %s\n' "$_pr_name" "$(tp_role_word "$_pr_role")" "$_pr_branch" "$_pr_vs" "$_pr_dirty"
    fi
  done
}

# Warn about branch names that exist in more than one repo (twin pull requests).
tp_twin_branches() {
  _tb_all=
  for _tb_name in $(tp_repo_names); do
    _tb_path="$DIR/$_tb_name"
    tp_is_checkout "$_tb_path" || continue
    _tb_default=$(tp_repo_branch "$_tb_name")
    for _tb_branch in $(git -C "$_tb_path" for-each-ref --format='%(refname:short)' refs/heads 2>/dev/null); do
      # The default branch and the long-lived release branches are not twins.
      case "$_tb_branch" in "$_tb_default" | staging | live) continue ;; *) ;; esac
      _tb_all="${_tb_all}${_tb_branch} ${_tb_name}
"
    done
  done
  [ -n "$_tb_all" ] || return 0
  printf '%s' "$_tb_all" | awk '
    { repos[$1] = repos[$1] " " $2; count[$1]++ }
    END { for (b in count) if (count[b] > 1) print b ":" repos[b] }
  ' | sort | while IFS= read -r _tb_line; do
    _tb_b=${_tb_line%%:*}
    _tb_r=${_tb_line#*:}
    tp_warn "Branch ${_tb_b} exists in:${_tb_r}. Link the pull requests to each other in their descriptions."
    case " ${_tb_r} " in
      *" turbopanel "*)
        case " ${_tb_r} " in
          *" turbopaneld "*)
            tp_warn "  When the wire contract changes, merge the control plane (turbopanel) pull request before the daemon (turbopaneld) one."
            ;;
          *) ;;
        esac
        ;;
      *) ;;
    esac
  done
}

tp_next_steps() {
  echo
  echo "Next:"
  if [ "$MODE" = vagrant ]; then
    if [ "$HOST_KERNEL" = Darwin ]; then
      echo "  cd $(tp_sq "$DIR/dev") && ./scripts/vagrant-up.sh"
    else
      echo "  cd $(tp_sq "$DIR/dev") && vagrant up && vagrant ssh"
      echo "  Then, inside the guest: turbopanel/dev/console"
    fi
    echo "  Edit and commit on this machine; the guest only runs the stack. Hooks here run the secret scan."
  elif [ "$MODE" = direct ]; then
    echo "  Log out and back in if setup just added you to the sudo group, then:"
    # The console finds the folder from the mode file next to the repos.
    echo "  $(tp_sq "$DIR/dev/console")"
  fi
}

tp_role_sentence() {
  _rse_role=$1
  case "$_rse_role" in
    maintainer)
      echo "You can push to ${TP_ORG} directly. Your repos point at ${TP_ORG}; push branches there and open pull requests from them. To work from your own fork instead, run: ${DIR}/dev/scripts/setup.sh fork <repo>"
      ;;
    contributor)
      echo "Your repos are read-only clones of ${TP_ORG}. When you are ready to push in one, run: ${DIR}/dev/scripts/setup.sh fork <repo>"
      ;;
    contributor-fork)
      echo "You work from your own fork. Your repos push to ${GH_LOGIN:-<your login>}/<repo> (origin); ${TP_ORG} is upstream. Push branches to your fork and open pull requests into ${TP_ORG}."
      ;;
    readonly)
      if [ -z "$GH_LOGIN" ]; then
        echo "You are not signed in to GitHub, so the repos are read-only. Run '${TP_GH_LOGIN_CMD}' and rerun this script."
      else
        echo "The repos are read-only clones (GitHub did not answer when they were set up). Rerun this script when you are online."
      fi
      ;;
    *) ;;
  esac
}

tp_role_label() {
  _rl_role=$1
  _rl_repo=$2
  case "$_rl_role" in
    maintainer) printf 'you push to %s directly' "$TP_ORG" ;;
    contributor) printf 'read-only clone; setup.sh fork %s to push' "$_rl_repo" ;;
    contributor-fork) printf 'forked' ;;
    readonly) printf 'read-only' ;;
    *) printf '%s' "$_rl_role" ;;
  esac
}

# One plain summary of what the person can do, from the role of each repo.
# The most common role sets the sentence; other repos are listed as exceptions.
tp_role_summary() {
  _rs_all=
  for _rs_name in $(tp_repo_names); do
    eval "_rs_role=\${ROLE_$(tp_role_suffix "$_rs_name"):-}"
    if [ -z "$_rs_role" ] && tp_is_checkout "$DIR/$_rs_name"; then
      _rs_role=$(tp_layout_role "$DIR/$_rs_name" "$_rs_name")
    fi
    case "$_rs_role" in
      maintainer | contributor | contributor-fork | readonly) _rs_all="${_rs_all}${_rs_name} ${_rs_role}
" ;;
      *) ;;
    esac
  done
  [ -n "$_rs_all" ] || return 0
  _rs_main=$(printf '%s' "$_rs_all" | awk '{n[$2]++} END {best=""; for (r in n) if (best == "" || n[r] > n[best] || (n[r] == n[best] && r < best)) best = r; print best}')
  echo
  tp_role_sentence "$_rs_main"
  _rs_except=$(printf '%s' "$_rs_all" | while read -r _rs_n _rs_r; do
    [ "$_rs_r" = "$_rs_main" ] || printf '%s (%s); ' "$_rs_n" "$(tp_role_label "$_rs_r" "$_rs_n")"
  done)
  [ -z "$_rs_except" ] || echo "Except: ${_rs_except%; }."
}

# gh asks which repository a fork checkout means on the first 'gh pr create';
# answer it once so pull requests go to TurboPanel. Best effort.
tp_set_gh_default() {
  _sd_name=$1
  [ -n "$GH_LOGIN" ] && [ "$GH_OFFLINE" -eq 0 ] && tp_have_gh || return 0
  if ! (cd "$DIR/$_sd_name" && gh repo set-default "${TP_ORG}/${_sd_name}" >/dev/null 2>&1); then
    tp_warn "${_sd_name}: gh repo set-default ${TP_ORG}/${_sd_name} failed; gh pr create may ask which repository you mean."
  fi
}

tp_cmd_setup() {
  [ "$(id -u)" -ne 0 ] || tp_die "run setup as your normal user, not root; it asks for sudo only where needed."
  command -v git >/dev/null 2>&1 ||
    tp_die "git is required. Debian: sudo apt-get install git. macOS: xcode-select --install."
  [ -f "$REPOS_LIST" ] || tp_die "missing ${REPOS_LIST}."

  tp_detect_host
  # gh and the login decide every repo's role, so they come before the plan.
  if [ "$DRY_RUN" -eq 0 ]; then
    tp_ensure_gh
    tp_offer_gh_login
  fi
  tp_detect_login
  tp_detect_protocol
  tp_choose_mode

  if [ "$GH_CHANGED" -eq 1 ]; then
    echo "Plan (no repo has changed yet):"
  else
    echo "Plan (nothing has changed yet):"
  fi
  echo "  Folder:       ${DIR}"
  echo "  Mode:         ${MODE:-not chosen}"
  echo "  Host:         ${OS_NAME:-$HOST_KERNEL} ${HOST_ARCH}${VIRT:+ (virtualization: ${VIRT})}"
  if [ -n "$GH_LOGIN" ]; then
    echo "  GitHub:       logged in as ${GH_LOGIN}, cloning over ${CLONE_PROTOCOL}"
  else
    echo "  GitHub:       not logged in; read-only clones over https"
  fi
  [ "$DRY_RUN" -eq 0 ] || tp_gh_plan
  if [ "$DEV_CHECKOUT" != "$DIR/dev" ]; then
    echo "  Note:         this dev checkout (${DEV_CHECKOUT}) is outside the folder; ${DIR}/dev is used from now on."
  fi
  for _cs_name in $(tp_repo_names); do
    _cs_role=$(tp_detect_role "$_cs_name")
    eval "ROLE_$(tp_role_suffix "$_cs_name")=\$_cs_role"
    if [ -e "$DIR/$_cs_name" ]; then
      _cs_action="present: fetch, fast-forward ${_cs_name} $(tp_repo_branch "$_cs_name") only if clean"
    elif [ "$_cs_role" = contributor ]; then
      _cs_action="clone ${TP_ORG}/${_cs_name} read-only as origin (setup.sh fork ${_cs_name} when you want to push)"
    elif [ "$_cs_role" = contributor-fork ]; then
      _cs_action="fork to ${GH_LOGIN}/${_cs_name} if needed, clone it as origin, upstream = ${TP_ORG}/${_cs_name}, gh repo set-default ${TP_ORG}/${_cs_name}"
    else
      _cs_action="clone ${TP_ORG}/${_cs_name} as origin"
    fi
    printf '  %-12s %-12s %s\n' "$_cs_name" "$_cs_role" "$_cs_action"
  done
  if [ -n "$GH_LOGIN" ] && [ "$GH_OFFLINE" -eq 0 ] && [ "$CLONE_PROTOCOL" = https ]; then
    echo "  Git config:   gh auth setup-git (adds gh as the github.com credential helper in your global git config)"
  fi
  echo "  Then:         core.hooksPath=.githooks in each repo where it is unset, write $(tp_mode_file)"
  if [ "$MODE" = direct ]; then
    echo "  Direct mode:  sudo sh dev/scripts/vm-bootstrap.sh $(id -un) (base packages, sudo rule, profile file)"
  elif [ "$MODE" = vagrant ]; then
    tp_vagrant_hints
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "Dry run: nothing changed."
    return 0
  fi
  if [ "$ASSUME_YES" -eq 0 ]; then
    tp_has_tty || tp_die "no terminal to confirm on; nothing changed. Pass --yes to run without asking."
    if ! tp_read_tty_yn "Go ahead?" y; then
      echo "Stopped; nothing changed."
      return 0
    fi
  fi

  mkdir -p "$DIR"
  trap tp_cleanup EXIT
  trap 'tp_cleanup; exit 130' INT TERM
  if [ -n "$GH_LOGIN" ] && [ "$GH_OFFLINE" -eq 0 ] && [ "$CLONE_PROTOCOL" = https ]; then
    gh auth setup-git >/dev/null 2>&1 || tp_warn "gh auth setup-git failed; pushes over https may ask for a password."
  fi
  for _cs_name in $(tp_repo_names); do
    eval "_cs_role=\$ROLE_$(tp_role_suffix "$_cs_name")"
    tp_sync_repo "$_cs_name" "$(tp_repo_branch "$_cs_name")" "$_cs_role"
  done
  tp_write_mode_file
  if [ "$MODE" = direct ]; then
    tp_direct_bootstrap
  fi

  echo
  tp_print_rows 0
  tp_twin_branches
  tp_role_summary
  tp_next_steps
  if [ -n "$FAILED" ]; then
    tp_error "Not finished:${FAILED}. Fix the errors above and rerun; finished repos are kept."
    return 1
  fi
  tp_success "Setup finished. Mode file: $(tp_mode_file)"
}

# ---------------------------------------------------------------- fork

# Can this checkout be pointed at a fork? Checked before anything is created
# on GitHub. Sets FP_STATE (ready, forked or bad) and FP_WHY.
tp_fork_precheck() {
  _fp_path=$1
  _fp_name=$2
  FP_WHY=
  FP_STATE=ready
  if ! tp_is_checkout "$_fp_path"; then
    FP_STATE=bad
    FP_WHY="${_fp_path} is not a checkout; run setup first"
  elif tp_fork_shaped "$_fp_path" "$_fp_name"; then
    FP_STATE=forked
  elif ! tp_same_slug "$(tp_remote_slug "$_fp_path" origin)" "${TP_ORG}/${_fp_name}"; then
    FP_STATE=bad
    FP_WHY="origin is $(git -C "$_fp_path" remote get-url origin 2>/dev/null || echo missing), not ${TP_ORG}/${_fp_name}; left as it is"
  elif tp_has_remote "$_fp_path" upstream; then
    FP_STATE=bad
    FP_WHY="an upstream remote already points to $(git -C "$_fp_path" remote get-url upstream); rename or remove it (git remote remove upstream) and rerun"
  fi
}

# Fork one repo and point its checkout at the fork. Keeps every branch and
# commit; only the remotes change (origin = your fork, upstream = TurboPanel).
tp_fork_repo() {
  _fo_name=$1
  _fo_path="$DIR/$_fo_name"
  _fo_key=$(tp_role_suffix "$_fo_name")
  tp_fork_precheck "$_fo_path" "$_fo_name"
  case "$FP_STATE" in
    forked)
      tp_info "${_fo_name}: already forked (origin $(tp_remote_slug "$_fo_path" origin), upstream ${TP_ORG}/${_fo_name}); nothing to do."
      eval "ROLE_${_fo_key}=contributor-fork"
      return 0
      ;;
    bad)
      tp_fail_repo "$_fo_name" "$FP_WHY"
      return 0
      ;;
    *) ;;
  esac
  if ! tp_ensure_fork "$_fo_name"; then
    tp_fail_repo "$_fo_name" "no fork to work from"
    return 0
  fi
  _fo_role=$(tp_reconcile_remotes "$_fo_path" "$_fo_name" contributor-fork "$EF_SLUG")
  if [ "$_fo_role" != contributor-fork ]; then
    tp_fail_repo "$_fo_name" "the remotes could not be pointed at ${EF_SLUG}; left as they are"
    return 0
  fi
  tp_fetch "$_fo_path" origin "$_fo_name"
  tp_fetch "$_fo_path" upstream "$_fo_name"
  _fo_branch=$(tp_repo_branch "$_fo_name")
  if git -C "$_fo_path" rev-parse -q --verify "refs/heads/${_fo_branch}" >/dev/null 2>&1 &&
    git -C "$_fo_path" rev-parse -q --verify "refs/remotes/upstream/${_fo_branch}" >/dev/null 2>&1; then
    git -C "$_fo_path" branch --quiet --set-upstream-to="upstream/${_fo_branch}" "$_fo_branch" >/dev/null 2>&1 || true
  fi
  tp_set_gh_default "$_fo_name"
  eval "ROLE_${_fo_key}=contributor-fork"
  tp_success "${_fo_name}: origin is your fork ${EF_SLUG}; ${TP_ORG}/${_fo_name} is upstream."
}

tp_cmd_fork() {
  [ "$(id -u)" -ne 0 ] || tp_die "run setup as your normal user, not root."
  command -v git >/dev/null 2>&1 || tp_die "git is required."
  [ -n "$FORK_REPOS" ] || { tp_usage >&2; exit 2; }
  # Repo names split on spaces only, never expanded as file patterns.
  set -f
  for _cf_name in $FORK_REPOS; do
    tp_repo_names | grep -qxF -- "$_cf_name" ||
      tp_die "unknown repo ${_cf_name}; use one of: $(tp_repo_names | tr '\n' ' ')"
  done
  [ -f "$(tp_mode_file)" ] || tp_die "no mode file at $(tp_mode_file); run ${DIR}/dev/scripts/setup.sh first."
  MODE=$(tp_mode_get TURBOPANEL_DEV_ENV)
  if [ "$DRY_RUN" -eq 1 ]; then
    # No GitHub call and no remote change: only what each checkout allows.
    echo "Plan (nothing changes):"
    for _cf_name in $FORK_REPOS; do
      tp_fork_precheck "$DIR/$_cf_name" "$_cf_name"
      case "$FP_STATE" in
        forked) echo "  ${_cf_name}: already forked; nothing to do" ;;
        bad) echo "  ${_cf_name}: cannot fork: ${FP_WHY}" ;;
        *) echo "  ${_cf_name}: fork ${TP_ORG}/${_cf_name} to your account (or reuse your fork), make it origin, ${TP_ORG}/${_cf_name} upstream, track upstream/$(tp_repo_branch "$_cf_name"), gh repo set-default ${TP_ORG}/${_cf_name}" ;;
      esac
    done
    set +f
    echo "Dry run: nothing changed."
    return 0
  fi
  tp_have_gh || tp_die "forking needs the GitHub CLI (gh); $(tp_gh_missing_hint), then rerun."
  tp_offer_gh_login
  tp_detect_login
  [ -n "$GH_LOGIN" ] || tp_die "you are not signed in to GitHub; run '${TP_GH_LOGIN_CMD}' in a plain SSH terminal and rerun."
  [ "$GH_OFFLINE" -eq 0 ] || tp_die "GitHub did not answer (offline?); nothing changed. Rerun when online."
  tp_detect_protocol
  for _cf_name in $FORK_REPOS; do
    tp_fork_repo "$_cf_name"
  done
  set +f
  tp_write_mode_file
  if [ -n "$FAILED" ]; then
    tp_error "Not finished:${FAILED}. Fix the errors above and rerun."
    return 1
  fi
  echo "Push branches to your fork (git push origin <branch>) and open pull requests into ${TP_ORG}."
}

# ---------------------------------------------------------------- doctor

PROBLEMS=0

tp_problem() {
  PROBLEMS=$((PROBLEMS + 1))
  tp_error "$*"
}

tp_cmd_doctor() {
  tp_detect_host
  echo "Host"
  echo "  uname:        ${HOST_KERNEL} ${HOST_ARCH}"
  echo "  system:       ${OS_NAME:-unknown}${OS_VERSION_ID:+ (VERSION_ID ${OS_VERSION_ID})}"
  echo "  virtual:      ${VIRT:-unknown}${CONTAINER:+, container ${CONTAINER}}"
  if [ -f "$VAGRANT_GUEST_MARKER" ]; then
    echo "  this is the Vagrant guest; commit on the host, not here"
  fi
  if command -v vagrant >/dev/null 2>&1; then
    echo "  vagrant:      $(vagrant --version 2>/dev/null | head -n 1)"
    if [ -n "$PROVIDER_PLUGIN" ]; then
      if vagrant plugin list 2>/dev/null | grep -q "^${PROVIDER_PLUGIN}"; then
        echo "  provider:     ${PROVIDER} (${PROVIDER_PLUGIN} installed)"
      else
        echo "  provider:     ${PROVIDER} (${PROVIDER_PLUGIN} missing)"
      fi
    fi
  else
    echo "  vagrant:      not installed"
  fi
  [ "$HOST_KERNEL" != Linux ] || echo "  /dev/kvm:     $([ -e /dev/kvm ] && echo present || echo missing)"
  echo "  direct mode:  $([ "$DIRECT_OK" -eq 1 ] && echo available || echo "not available, ${DIRECT_WHY}")"

  echo "Tools"
  if command -v git >/dev/null 2>&1; then
    echo "  git:          $(git --version)"
  else
    tp_problem "git is not installed"
  fi
  if command -v gh >/dev/null 2>&1; then
    echo "  gh:           $(gh --version 2>/dev/null | head -n 1)"
  else
    tp_warn "gh is not installed; pull requests and forks need it (https://cli.github.com)"
  fi
  tp_detect_login
  if [ -n "$GH_LOGIN" ]; then
    echo "  login:        ${GH_LOGIN}"
  else
    tp_warn "not logged in to GitHub (${TP_GH_LOGIN_CMD})"
  fi

  echo "Mode file"
  _dr_mode=$(tp_mode_get TURBOPANEL_DEV_ENV)
  if [ -f "$(tp_mode_file)" ]; then
    echo "  file:         $(tp_mode_file)"
    echo "  mode:         ${_dr_mode:-unset}"
    _dr_root=$(tp_mode_get dev_root)
    echo "  dev_root:     ${_dr_root:-unset}"
    if [ -n "$_dr_root" ] && [ "$_dr_root" != "$DIR" ] && [ ! -f "$VAGRANT_GUEST_MARKER" ]; then
      tp_problem "mode file dev_root ${_dr_root} differs from ${DIR}"
    fi
  else
    tp_warn "no mode file at $(tp_mode_file); run ./scripts/setup.sh"
  fi
  case "$_dr_mode" in
    direct)
      [ "$DIRECT_OK" -eq 1 ] || [ -f "$VAGRANT_GUEST_MARKER" ] ||
        tp_problem "mode is direct but ${DIRECT_WHY}"
      ;;
    vagrant)
      if [ "$HOST_KERNEL" = Darwin ]; then
        echo "  note:         the macOS guest runs Debian 12 (utm/bookworm); Linux guests and direct mode run Debian 13"
      fi
      ;;
    *) ;;
  esac
  if [ "$OS_ID" = debian ] && [ "$OS_VERSION_ID" = 12 ]; then
    echo "  note:         Debian 12 here; only the macOS Vagrant guest is expected on 12, direct mode needs 13"
  fi

  echo "Repos in ${DIR}"
  for _dr_name in $(tp_repo_names); do
    _dr_path="$DIR/$_dr_name"
    if ! tp_is_checkout "$_dr_path"; then
      tp_problem "${_dr_name}: missing"
      continue
    fi
    _dr_role=$(tp_layout_role "$_dr_path" "$_dr_name")
    echo "  ${_dr_name} (${_dr_role}, $(tp_role_word "$_dr_role"))"
    echo "    origin:     $(git -C "$_dr_path" remote get-url origin 2>/dev/null || echo none)"
    if tp_has_remote "$_dr_path" upstream; then
      echo "    upstream:   $(git -C "$_dr_path" remote get-url upstream)"
    fi
    if [ "$_dr_role" = contributor-fork ] && ! tp_same_slug "$(tp_remote_slug "$_dr_path" upstream)" "${TP_ORG}/${_dr_name}"; then
      tp_problem "${_dr_name}: fork checkout without upstream = ${TP_ORG}/${_dr_name}"
    fi
    if [ "$_dr_role" = contributor ] && [ -n "$GH_LOGIN" ]; then
      echo "    to push:    ${DIR}/dev/scripts/setup.sh fork ${_dr_name}"
    fi
    if [ "$_dr_role" = maintainer ] && ! tp_same_slug "$(tp_remote_slug "$_dr_path" origin)" "${TP_ORG}/${_dr_name}"; then
      tp_problem "${_dr_name}: maintainer checkout whose origin is not ${TP_ORG}/${_dr_name}"
    fi
    if [ -f "$_dr_path/.githooks/pre-commit" ]; then
      _dr_hooks=$(git -C "$_dr_path" config --get core.hooksPath 2>/dev/null || true)
      if [ "$_dr_hooks" = .githooks ]; then
        echo "    hooks:      .githooks"
      elif [ -z "$_dr_hooks" ]; then
        tp_problem "${_dr_name}: core.hooksPath is unset, expected .githooks (rerun setup)"
      else
        # A hooks folder of your own is a choice; setup keeps it too.
        tp_warn "${_dr_name}: core.hooksPath is ${_dr_hooks}, not .githooks; the repo's pre-commit hook (secret scan) does not run"
      fi
    fi
  done

  echo "Signing (where you commit: $([ "$_dr_mode" = vagrant ] && echo 'this host' || echo 'this machine'))"
  _dr_git="$DIR/dev"
  tp_is_checkout "$_dr_git" || _dr_git=.
  echo "  commit.gpgsign: $(git -C "$_dr_git" config --get commit.gpgsign 2>/dev/null || echo unset)"
  echo "  gpg.format:     $(git -C "$_dr_git" config --get gpg.format 2>/dev/null || echo 'unset (openpgp)')"
  echo "  signing key:    $(git -C "$_dr_git" config --get user.signingkey >/dev/null 2>&1 && echo set || echo unset)"
  if [ -z "${SSH_AUTH_SOCK:-}" ]; then
    echo "  SSH agent:      not running"
  elif command -v ssh-add >/dev/null 2>&1; then
    _dr_keys=$(ssh-add -L 2>/dev/null | grep -c '^[a-z]' || true)
    echo "  SSH agent:      ${_dr_keys} key(s) loaded"
  fi

  echo
  if [ "$PROBLEMS" -gt 0 ]; then
    tp_error "${PROBLEMS} problem(s) found."
    return 1
  fi
  tp_success "No problems found."
}

tp_cmd_status() {
  command -v git >/dev/null 2>&1 || tp_die "git is required."
  tp_detect_login
  echo "Repos in ${DIR} (as of the last fetch)"
  tp_print_rows 1
  tp_twin_branches
  tp_role_summary
}

# ---------------------------------------------------------------- main

while [ "$#" -gt 0 ]; do
  case "$1" in
    setup | doctor | status | fork) COMMAND=$1 ;;
    --dir)
      [ "$#" -ge 2 ] || { tp_usage >&2; exit 2; }
      DIR=$2
      shift
      ;;
    --dir=*) DIR=${1#--dir=} ;;
    --mode)
      [ "$#" -ge 2 ] || { tp_usage >&2; exit 2; }
      MODE=$2
      shift
      ;;
    --mode=*) MODE=${1#--mode=} ;;
    --as-contributor) FORCE_FORK=1 ;;
    --fork) tp_warn "--fork is now --as-contributor; use --as-contributor."; FORCE_FORK=1 ;;
    --fork-all) FORK_ALL=1 ;;
    --yes | -y) ASSUME_YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h | --help) tp_usage; exit 0 ;;
    -*) echo "setup: unknown argument: $1" >&2; tp_usage >&2; exit 2 ;;
    *)
      [ "$COMMAND" = fork ] || { echo "setup: unknown argument: $1" >&2; tp_usage >&2; exit 2; }
      FORK_REPOS="${FORK_REPOS}${FORK_REPOS:+ }$1"
      ;;
  esac
  shift
done

case "$MODE" in
  '' | direct | vagrant) ;;
  *) tp_die "unknown mode ${MODE}; use direct or vagrant." ;;
esac

tp_resolve_dir
case "$COMMAND" in
  setup) tp_cmd_setup ;;
  doctor) tp_cmd_doctor ;;
  status) tp_cmd_status ;;
  fork) tp_cmd_fork ;;
  *) ;;
esac

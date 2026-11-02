#!/bin/sh
# Start the TurboPanel development setup on a machine that has no checkout yet.
#
#   curl -fsSL https://raw.githubusercontent.com/TurboPanel/dev/trunk/scripts/start.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/TurboPanel/dev/trunk/scripts/start.sh | sh -s -- [options]
#   sh start.sh [options]            (after downloading and reading it)
#
# It works from any folder, needs only git and curl or wget, and installs
# nothing: it clones the dev repo into <folder>/dev (default ~/turbopanel/dev)
# over HTTPS, or reuses that checkout when it is already there, and then hands
# over to <folder>/dev/scripts/setup.sh, which prints its plan and asks before it
# changes anything (including how you want to run TurboPanel: Vagrant or this
# Debian 13 machine directly). Every option it does not know goes to setup.sh.
#
# The whole script is functions plus one call on the last line, which passes
# an end marker after your options. A download cut short before that line
# runs nothing; one cut inside it fails on the missing marker (or a syntax
# error) instead of running with lost options. Nothing after the call is left
# on the pipe for setup.sh to read.
set -eu

TP_DEV_URL=https://github.com/TurboPanel/dev.git
TP_RAW_URL=https://raw.githubusercontent.com/TurboPanel/dev/trunk/scripts/start.sh
TP_START_END=--tp-start-end

tp_start_usage() {
  cat <<USAGE
Usage: start.sh [--dir PATH] [--dry-run] [setup options]
       curl -fsSL ${TP_RAW_URL} | sh -s -- [options]

Clones ${TP_DEV_URL} into <folder>/dev (or reuses it when it is
already there), then runs <folder>/dev/scripts/setup.sh with the other options.

Options:
  --dir PATH   folder that holds the repos: an absolute path to a folder named
               turbopanel (default: \$HOME/turbopanel)
  --dry-run    print the plan and stop; nothing is cloned. With a dev checkout
               already in place, setup.sh prints its own dry-run plan too
  -h, --help   show this help

Everything else goes to setup.sh unchanged, for example --mode direct|vagrant,
--as-contributor, --yes, doctor or status. See setup.sh --help once the dev repo is here.
USAGE
}

tp_start_die() {
  printf 'start: %s\n' "$*" >&2
  exit 1
}

# Same rules as tp_validate_dev_root in scripts/lib/paths.sh and setup.sh's
# direct mode (docs/dev-environment.md, Repos Outside the Home Folder): the
# folder name is written unquoted into env files, systemd units and Ansible
# arguments later, so only plain characters are allowed.
tp_start_check_dir() {
  _cd_dir=$1
  _cd_what=$2
  while [ "${#_cd_dir}" -gt 1 ] && [ "${_cd_dir%/}" != "$_cd_dir" ]; do
    _cd_dir=${_cd_dir%/}
  done
  case $_cd_dir in
    /) tp_start_die "${_cd_what} must not be the filesystem root." ;;
    /*) ;;
    *) tp_start_die "${_cd_what} must be an absolute path (got ${_cd_dir})." ;;
  esac
  case $_cd_dir in
    *[!A-Za-z0-9._@+/-]*) tp_start_die "${_cd_what} may only contain letters, digits and . _ @ + - / (no spaces or shell characters): ${_cd_dir}" ;;
    *) ;;
  esac
  case "$_cd_dir/" in
    */./* | */../*) tp_start_die "${_cd_what} must not contain . or .. parts: ${_cd_dir}" ;;
    *) ;;
  esac
  [ "${_cd_dir##*/}" = turbopanel ] ||
    tp_start_die "the repos belong in a folder named turbopanel (for example \$HOME/turbopanel), not ${_cd_dir}."
  if [ -e "$_cd_dir/.git" ]; then
    tp_start_die "${_cd_dir} is a git checkout, not the folder that holds the repos. If your repos sit directly in your home folder, move them into a folder named turbopanel first (see docs/dev-environment.md, Moving an Existing Home-Folder Layout)."
  fi
  START_DIR=$_cd_dir
}

# True when <path> is the top of a git checkout with a remote pointing at
# TurboPanel/dev (origin for maintainers, upstream for fork checkouts).
tp_start_is_dev_checkout() {
  _dc_path=$1
  [ -e "$_dc_path/.git" ] || return 1
  _dc_top=$(git -C "$_dc_path" rev-parse --show-toplevel 2>/dev/null) || return 1
  [ "$_dc_top" = "$(CDPATH='' cd -- "$_dc_path" && pwd -P)" ] || return 1
  for _dc_remote in origin upstream; do
    _dc_url=$(git -C "$_dc_path" remote get-url "$_dc_remote" 2>/dev/null | tr '[:upper:]' '[:lower:]') || continue
    case "${_dc_url%.git}" in
      https://github.com/turbopanel/dev | git@github.com:turbopanel/dev | ssh://git@github.com/turbopanel/dev) return 0 ;;
      *) ;;
    esac
  done
  return 1
}

tp_start_main() {
  START_DIR=
  _sm_dir=
  _sm_dir_set=0
  _sm_dry=0
  # The last argument is the end marker from the call on the script's last
  # line; without it the download was cut short. Rotate through the others
  # once: ours are consumed, the rest are appended to "$@" for setup.sh.
  _sm_left=$(($# - 1))
  while [ "$_sm_left" -gt 0 ]; do
    _sm_arg=$1
    shift
    _sm_left=$((_sm_left - 1))
    case "$_sm_arg" in
      --dir)
        [ "$_sm_left" -gt 0 ] || { tp_start_usage >&2; exit 2; }
        _sm_dir=$1
        _sm_dir_set=1
        shift
        _sm_left=$((_sm_left - 1))
        ;;
      --dir=*)
        _sm_dir=${_sm_arg#--dir=}
        _sm_dir_set=1
        ;;
      --dry-run) _sm_dry=1 ;;
      -h | --help) tp_start_usage; exit 0 ;;
      *) set -- "$@" "$_sm_arg" ;;
    esac
  done
  _sm_end=${1-}
  if [ "$#" -eq 0 ] || [ "$_sm_end" != "$TP_START_END" ]; then
    tp_start_die "this script looks cut short (an interrupted download?); nothing ran. Download it again."
  fi
  shift
  [ "$_sm_dry" -eq 0 ] || set -- "$@" --dry-run

  [ "$(id -u)" -ne 0 ] || tp_start_die "run this as your normal user, not root; setup asks for sudo only where it needs it."
  command -v git >/dev/null 2>&1 ||
    tp_start_die "git is required. Debian or Ubuntu: sudo apt-get install git (on a fresh Debian without sudo: su -c 'apt-get install -y git sudo'). macOS: xcode-select --install."
  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    tp_start_die "curl or wget is required. Debian or Ubuntu: sudo apt-get install curl. macOS ships curl."
  fi

  if [ "$_sm_dir_set" -eq 1 ]; then
    [ -n "$_sm_dir" ] || tp_start_die "--dir needs a folder, for example --dir \$HOME/turbopanel."
    tp_start_check_dir "$_sm_dir" "--dir"
  else
    [ -n "${HOME:-}" ] || tp_start_die "HOME is not set; pass --dir /path/to/turbopanel."
    tp_start_check_dir "$HOME/turbopanel" "the default folder (\$HOME/turbopanel; pass --dir to use another folder named turbopanel)"
  fi
  _sm_dev="$START_DIR/dev"
  _sm_setup="$_sm_dev/scripts/setup.sh"

  _sm_have=0
  if [ -L "$_sm_dev" ] && [ ! -e "$_sm_dev" ]; then
    tp_start_die "${_sm_dev} is a symlink to nothing; remove it or pick another folder with --dir."
  fi
  if [ -e "$_sm_dev" ]; then
    tp_start_is_dev_checkout "$_sm_dev" ||
      tp_start_die "${_sm_dev} exists but is not a git checkout of TurboPanel/dev; move it away or pick another folder with --dir."
    [ -f "$_sm_setup" ] || tp_start_die "${_sm_setup} is missing; update ${_sm_dev} (git -C ${_sm_dev} pull) and rerun."
    _sm_have=1
  fi

  echo "TurboPanel development setup"
  echo "  Folder:   ${START_DIR} (the same whichever way you run TurboPanel)"
  if [ "$_sm_have" -eq 1 ]; then
    echo "  dev repo: ${_sm_dev} is already here; setup.sh updates it"
  else
    echo "  dev repo: clone ${TP_DEV_URL} into ${_sm_dev}"
  fi
  echo "  Then:     sh ${_sm_setup}${*:+ $*} --dir ${START_DIR}"
  echo "setup.sh shows its own plan and asks before it changes anything, including how"
  echo "you want to run TurboPanel:"
  echo "  Vagrant: the repos stay in ${START_DIR} on this machine; 'vagrant up' in ${_sm_dev} runs them in a Debian VM."
  if [ "$(uname -s 2>/dev/null)" = Darwin ]; then
    echo "  (Direct mode needs a Debian 13 machine, so on macOS setup uses Vagrant.)"
  else
    echo "  Direct:  a Debian 13 machine becomes the dev machine itself; setup gives your user passwordless sudo."
  fi

  if [ "$_sm_have" -eq 0 ]; then
    if [ "$_sm_dry" -eq 1 ]; then
      echo "Dry run: nothing cloned. setup.sh's own dry run needs the dev repo, so it cannot run yet."
      return 0
    fi
    mkdir -p "$START_DIR"
    _sm_tmp="$START_DIR/.start-clone-dev"
    rm -rf "$_sm_tmp"
    trap 'rm -rf "$_sm_tmp"' EXIT
    trap 'rm -rf "$_sm_tmp"; exit 130' INT TERM
    echo "Cloning ${TP_DEV_URL}"
    GIT_TERMINAL_PROMPT=0
    export GIT_TERMINAL_PROMPT
    git clone --quiet "$TP_DEV_URL" "$_sm_tmp" </dev/null ||
      tp_start_die "could not clone ${TP_DEV_URL} (offline?); nothing else changed."
    # Never move the clone into or over something that appeared meanwhile.
    if [ -e "$_sm_dev" ] || [ -L "$_sm_dev" ]; then
      tp_start_die "${_sm_dev} appeared while cloning; left it alone. Move it away and rerun."
    fi
    mv "$_sm_tmp" "$_sm_dev" ||
      tp_start_die "could not move the clone to ${_sm_dev}."
    trap - EXIT INT TERM
    [ -f "$_sm_setup" ] || tp_start_die "${_sm_setup} is missing in the fresh clone."
  fi

  # Under curl | sh, stdin is the download pipe. Give setup.sh the terminal so
  # its questions (and anything it starts) read from the keyboard, not the pipe.
  if [ ! -t 0 ] && (: </dev/tty) 2>/dev/null; then
    exec sh "$_sm_setup" "$@" --dir "$START_DIR" </dev/tty
  fi
  exec sh "$_sm_setup" "$@" --dir "$START_DIR"
}

tp_start_main "$@" "$TP_START_END"

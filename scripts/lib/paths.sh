# TurboPanel filesystem layout (POSIX sh).
# Source after privileges.sh when needed.

TURBOPANEL_ROOT=/opt/turbopanel
# Development source-repo root (turbopaneld/turbopanel/ui/website live here).
# Defaults to the dev user's home; override with TURBOPANEL_DEV_ROOT, or let
# ./console read it from the mode file setup.sh writes next to the repos
# (tp_load_dev_root_mode_file). An explicit TURBOPANEL_DEV_ROOT always wins.
TP_DEV_ROOT_FROM_ENV=${TURBOPANEL_DEV_ROOT:+1}
TURBOPANEL_DEV_ROOT=${TURBOPANEL_DEV_ROOT:-$HOME}

# When TURBOPANEL_DEV_ROOT was not set by the caller, take it from
# <folder holding the dev checkout>/.turbopanel-dev-mode (key dev_root). The
# file is parsed, never sourced: only a line dev_root='...' counts, and the
# '\'' escape setup.sh writes for a quote is undone. The file sits next to the
# repos, so when its dev_root names another folder (the checkout was moved)
# the folder that holds the file wins, with a warning.
#   tp_load_dev_root_mode_file <dev checkout dir>
# Print the symlink-free path of an existing folder; prints nothing otherwise.
tp_physical_dir() {
  _tp_pd_dir=$1
  (CDPATH='' cd -P -- "$_tp_pd_dir" 2>/dev/null && pwd) || true
}

tp_load_dev_root_mode_file() {
  [ -z "$TP_DEV_ROOT_FROM_ENV" ] || return 0
  _tp_lm_dev=$1
  _tp_lm_parent=$(CDPATH='' cd -- "$_tp_lm_dev/.." 2>/dev/null && pwd) || return 0
  _tp_lm_file=$_tp_lm_parent/.turbopanel-dev-mode
  [ -f "$_tp_lm_file" ] || return 0
  _tp_lm_root=$(sed -n "s/^dev_root='\(.*\)'\$/\1/p" "$_tp_lm_file" | tail -n 1 | sed "s/'\\\\''/'/g")
  [ -n "$_tp_lm_root" ] || return 0
  if [ "$(tp_physical_dir "$_tp_lm_root")" = "$(tp_physical_dir "$_tp_lm_parent")" ]; then
    TURBOPANEL_DEV_ROOT=$_tp_lm_root
  else
    printf 'TurboPanel: %s says dev_root=%s, but it sits in %s; using %s (rerun dev/scripts/setup.sh to update it).\n' \
      "$_tp_lm_file" "$_tp_lm_root" "$_tp_lm_parent" "$_tp_lm_parent" >&2
    TURBOPANEL_DEV_ROOT=$_tp_lm_parent
  fi
}
# Check TURBOPANEL_DEV_ROOT (or $1) before anything uses it; prints the problem
# and returns 1 when it is unusable. Without $1 it also drops trailing slashes
# from TURBOPANEL_DEV_ROOT, matching the daemon's resolver. The character rules
# match devRootSyntaxError in src/lib/dev-root.ts. The value is
# written unquoted into systemd Environment= lines, KEY=VALUE env files, a YAML
# vars file, Caddyfile placeholders and Ansible `-e key=value` pairs, so it must
# be an absolute path of plain characters (no spaces or shell/YAML characters),
# and either a directory the user can read or one it can create.
tp_validate_dev_root() {
  _tp_vdr=${1-$TURBOPANEL_DEV_ROOT}
  while [ "${#_tp_vdr}" -gt 1 ] && [ "${_tp_vdr%/}" != "$_tp_vdr" ]; do
    _tp_vdr=${_tp_vdr%/}
  done
  _tp_vdr_err=
  case $_tp_vdr in
    /) _tp_vdr_err='must not be the filesystem root' ;;
    /*) ;;
    *) _tp_vdr_err='must be an absolute path' ;;
  esac
  if [ -z "$_tp_vdr_err" ]; then
    case $_tp_vdr in
      *[!A-Za-z0-9._@+/-]*) _tp_vdr_err='may only contain letters, digits and . _ @ + - / (no spaces or shell characters)' ;;
      *) ;;
    esac
  fi
  if [ -z "$_tp_vdr_err" ]; then
    case "$_tp_vdr/" in
      */./* | */../*) _tp_vdr_err='must not contain . or .. segments' ;;
      *) ;;
    esac
  fi
  if [ -z "$_tp_vdr_err" ]; then
    if [ -d "$_tp_vdr" ]; then
      if [ ! -r "$_tp_vdr" ] || [ ! -x "$_tp_vdr" ]; then
        _tp_vdr_err='is not readable by the current user'
      fi
    else
      _tp_vdr_parent=$_tp_vdr
      while [ ! -e "$_tp_vdr_parent" ]; do
        _tp_vdr_parent=$(dirname "$_tp_vdr_parent")
      done
      if [ ! -d "$_tp_vdr_parent" ]; then
        _tp_vdr_err='is not a directory and cannot be created'
      elif [ ! -w "$_tp_vdr_parent" ] || [ ! -x "$_tp_vdr_parent" ]; then
        _tp_vdr_err="cannot be created: $_tp_vdr_parent is not writable by the current user"
      fi
    fi
  fi
  if [ -n "$_tp_vdr_err" ]; then
    printf 'TURBOPANEL_DEV_ROOT=%s %s.\n' "$_tp_vdr" "$_tp_vdr_err" >&2
    return 1
  fi
  if [ "$#" -eq 0 ]; then
    TURBOPANEL_DEV_ROOT=$_tp_vdr
  fi
  return 0
}

# Development mode marker (published to daemon.env and the Node console).
TURBOPANEL_MODE=${TURBOPANEL_MODE:-development}

# Env key for a platform checkout override. Dir names match GitHub
# (turbopaneld/turbopanel); keys stay TURBOPANEL_DAEMON_REPO / INSTANCE_REPO.
tp_platform_repo_env_key() {
  _tp_env_dir=$1
  case "$_tp_env_dir" in
    turbopaneld) printf 'TURBOPANEL_DAEMON_REPO' ;;
    turbopanel) printf 'TURBOPANEL_INSTANCE_REPO' ;;
    *) printf 'TURBOPANEL_%s_REPO' "$(printf '%s' "$_tp_env_dir" | tr '[:lower:]' '[:upper:]')" ;;
  esac
}

# Resolve a co-located platform repo checkout (override via TURBOPANEL_*_REPO).
tp_platform_repo_path() {
  _tp_dir=$1
  _tp_key=$(tp_platform_repo_env_key "$_tp_dir")
  eval "_tp_override=\${$_tp_key-}"
  if [ -n "$_tp_override" ]; then
    printf '%s' "$_tp_override"
  else
    printf '%s/%s' "$TURBOPANEL_DEV_ROOT" "$_tp_dir"
  fi
}

# Export the dev-root/repo contract for child processes (vite-node console).
# TURBOPANEL_DEV_ROOT is the source of truth; a TURBOPANEL_*_REPO key is
# forwarded only when the caller set it explicitly, so consumers keep deriving
# <dev_root>/<repo> themselves and default paths are never persisted.
tp_export_dev_repo_contract() {
  export TURBOPANEL_MODE
  export TURBOPANEL_DEV_ROOT
  for _tp_repo_dir in turbopaneld turbopanel ui website; do
    _tp_repo_key=$(tp_platform_repo_env_key "$_tp_repo_dir")
    eval "_tp_repo_override=\${$_tp_repo_key-}"
    if [ -n "$_tp_repo_override" ]; then
      export "$_tp_repo_key"
    fi
  done
}
TURBOPANEL_ROOT=/opt/turbopanel
# Vendored runtime root (override with TURBOPANEL_RUNTIMES_DIR).
TURBOPANEL_RUNTIMES_DIR=${TURBOPANEL_RUNTIMES_DIR:-$TURBOPANEL_ROOT/vendor}
TURBOPANEL_RUNTIME=$TURBOPANEL_RUNTIMES_DIR

# FHS mutable dirs (dev shares the production paths, dev-owned at runtime).
TURBOPANEL_CONFIG_DIR=${TURBOPANEL_CONFIG_DIR:-/etc/turbopanel}
TURBOPANEL_LOG_DIR=${TURBOPANEL_LOG_DIR:-/var/log/turbopanel}
TURBOPANEL_STATE_DIR=${TURBOPANEL_STATE_DIR:-/var/lib/turbopanel}
DAEMON_ENV_PATH=${DAEMON_ENV_PATH:-$TURBOPANEL_CONFIG_DIR/daemon.env}

# Node is dev-only (Ink HMR via Vite + future website repo). Platform services
# (daemon, instance) use the platform-managed runtimes under vendor.
NODE_VERSION=26.7.0
NODE_RUNTIME_DIR=${NODE_RUNTIME_DIR:-$TURBOPANEL_RUNTIMES_DIR/node}
NODE_VERSION_DIR=$NODE_RUNTIME_DIR/$NODE_VERSION
NODE_PREFIX=${NODE_PREFIX:-$NODE_RUNTIME_DIR/current}
NODE_BIN=${NODE_BIN:-$NODE_PREFIX/bin/node}
NODE_RELEASE_BASE=https://nodejs.org/dist
# pnpm is provisioned via Corepack; version comes from package.json "packageManager".
# Node 25+ no longer ships Corepack — runtime.sh installs it with vendored npm.
# Corepack must not default-to-latest (see tp_corepack_env in runtime.sh).
PNPM_BIN=${PNPM_BIN:-$NODE_PREFIX/bin/pnpm}

# Pinned Deno for platform services — must match daemon deno-runtime and src/lib/paths.ts.
DENO_VERSION=2.9.8
DENO_RUNTIME_DIR=${DENO_RUNTIME_DIR:-$TURBOPANEL_RUNTIMES_DIR/deno}
VENDORED_DENO_BIN=${VENDORED_DENO_BIN:-$DENO_RUNTIME_DIR/current/deno}

# TurboPanel filesystem layout (POSIX sh).
# Source after privileges.sh when needed.

TURBOPANEL_ROOT=/opt/turbopanel
# Development source-repo root (daemon/instance/ui/website live here). Defaults to
# the dev user's home; override with TURBOPANEL_DEV_ROOT.
TURBOPANEL_DEV_ROOT=${TURBOPANEL_DEV_ROOT:-$HOME}
# Development mode marker (published to daemon.env and the Node console).
TURBOPANEL_MODE=${TURBOPANEL_MODE:-development}

# Resolve a co-located platform repo checkout (override via TURBOPANEL_<DIR>_REPO).
tp_platform_repo_path() {
  _tp_dir=$1
  _tp_key=$(printf 'TURBOPANEL_%s_REPO' "$(printf '%s' "$_tp_dir" | tr '[:lower:]' '[:upper:]')")
  eval "_tp_override=\${$_tp_key-}"
  if [ -n "$_tp_override" ]; then
    printf '%s' "$_tp_override"
  else
    printf '%s/%s' "$TURBOPANEL_DEV_ROOT" "$_tp_dir"
  fi
}

# Export the dev-root/repo contract for child processes (vite-node console).
tp_export_dev_repo_contract() {
  export TURBOPANEL_MODE
  export TURBOPANEL_DEV_ROOT
  export TURBOPANEL_DAEMON_REPO="$(tp_platform_repo_path daemon)"
  export TURBOPANEL_INSTANCE_REPO="$(tp_platform_repo_path instance)"
  export TURBOPANEL_UI_REPO="$(tp_platform_repo_path ui)"
  export TURBOPANEL_WEBSITE_REPO="$(tp_platform_repo_path website)"
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
NODE_VERSION=24.17.0
NODE_RUNTIME_DIR=${NODE_RUNTIME_DIR:-$TURBOPANEL_RUNTIMES_DIR/node}
NODE_VERSION_DIR=$NODE_RUNTIME_DIR/$NODE_VERSION
NODE_PREFIX=${NODE_PREFIX:-$NODE_RUNTIME_DIR/current}
NODE_BIN=${NODE_BIN:-$NODE_PREFIX/bin/node}
NODE_RELEASE_BASE=https://nodejs.org/dist
# pnpm is provisioned via Corepack; version comes from package.json "packageManager".
PNPM_BIN=${PNPM_BIN:-$NODE_PREFIX/bin/pnpm}

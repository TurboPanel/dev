# TurboPanel filesystem layout (POSIX sh).
# Source after privileges.sh when needed.

TURBOPANEL_ROOT=/opt/turbopanel
TURBOPANEL_PLATFORM=$TURBOPANEL_ROOT/platform
TURBOPANEL_RUNTIMES_DIR=${TURBOPANEL_RUNTIMES_DIR:-$TURBOPANEL_ROOT/runtimes}
TURBOPANEL_RUNTIME=$TURBOPANEL_RUNTIMES_DIR

# Node is dev-only (Ink HMR via Vite + future website repo). Platform services
# (daemon, instance) use the host or platform-managed Deno runtime — not Node.
NODE_VERSION=24.17.0
NODE_PREFIX=${NODE_PREFIX:-/usr/local}
NODE_BIN=${NODE_BIN:-$NODE_PREFIX/bin/node}
NODE_RELEASE_BASE=https://nodejs.org/dist
# pnpm is provisioned via Corepack; version comes from package.json "packageManager".
PNPM_BIN=${PNPM_BIN:-$(dirname "$NODE_BIN")/pnpm}

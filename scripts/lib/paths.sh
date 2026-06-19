# TurboPanel filesystem layout (POSIX sh).
# Source after privileges.sh when needed.

TURBOPANEL_ROOT=/opt/turbopanel
TURBOPANEL_PLATFORM=$TURBOPANEL_ROOT/platform
TURBOPANEL_RUNTIMES_DIR=${TURBOPANEL_RUNTIMES_DIR:-$TURBOPANEL_ROOT/runtimes}
TURBOPANEL_RUNTIME=$TURBOPANEL_RUNTIMES_DIR

DENO_VERSION=2.8.3
DENO_BIN=${DENO_BIN:-/usr/local/bin/deno}
DENO_RELEASE_BASE=https://github.com/denoland/deno/releases/download
DENO_LEGACY_RUNTIME_ROOT=$TURBOPANEL_RUNTIME/deno

# Node is dev-only (Ink HMR via Vite + future website repo). Production services
# (console launcher, daemon, instance) run on Deno. Installed from the official
# nodejs.org tarball into /usr/local, mirroring the pinned Deno install.
NODE_VERSION=24.17.0
NODE_PREFIX=${NODE_PREFIX:-/usr/local}
NODE_BIN=${NODE_BIN:-$NODE_PREFIX/bin/node}
NODE_RELEASE_BASE=https://nodejs.org/dist
# pnpm is provisioned via Corepack; version comes from package.json "packageManager".
PNPM_BIN=${PNPM_BIN:-$(dirname "$NODE_BIN")/pnpm}

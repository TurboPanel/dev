# TurboPanel filesystem layout (POSIX sh).
# Source after privileges.sh when needed.

TURBOPANEL_ROOT=/opt/turbopanel
TURBOPANEL_PLATFORM=$TURBOPANEL_ROOT/platform
TURBOPANEL_RUNTIME=$TURBOPANEL_ROOT/runtimes
# Pre-3f24600 layout used singular "runtime"; removed on next ./console run.
LEGACY_RUNTIME_ROOT=$TURBOPANEL_ROOT/runtime

DENO_VERSION=2.8.3
DENO_RUNTIME_ROOT=$TURBOPANEL_RUNTIME/deno
DENO_VERSION_DIR=$DENO_RUNTIME_ROOT/v$DENO_VERSION
DENO_BIN=$DENO_VERSION_DIR/bin/deno

#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
. "$SCRIPT_DIR/scripts/lib/privileges.sh"
. "$SCRIPT_DIR/scripts/lib/paths.sh"
. "$SCRIPT_DIR/scripts/lib/packages.sh"
. "$SCRIPT_DIR/scripts/lib/runtime.sh"

tp_ensure_deno_runtime

tp_info "Caching dependencies"
"$DENO_BIN" cache "$SCRIPT_DIR/src/main.tsx"

cd "$SCRIPT_DIR"
exec "$DENO_BIN" task dev

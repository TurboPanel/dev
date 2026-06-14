#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
. "$SCRIPT_DIR/scripts/lib/privileges.sh"
. "$SCRIPT_DIR/scripts/lib/paths.sh"
. "$SCRIPT_DIR/scripts/lib/packages.sh"
. "$SCRIPT_DIR/scripts/lib/runtime.sh"

if [ ! -t 0 ] || [ ! -t 1 ]; then
  tp_error "The developer console needs an interactive terminal."
  echo "Run ./dev.sh directly in a terminal — not through a pipe or redirect." >&2
  exit 1
fi

tp_ensure_deno_runtime

tp_info "Caching dependencies"
"$DENO_BIN" cache "$SCRIPT_DIR/src/main.tsx"

cd "$SCRIPT_DIR"
exec "$DENO_BIN" run --allow-all src/main.tsx

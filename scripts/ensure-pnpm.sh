#!/usr/bin/env bash
# Ensure pnpm >= 11 is available (existing install, corepack, or npm exec). Then run pnpm with args.
set -euo pipefail

PNPM_SPEC="${PNPM_SPEC:-}"

pnpm_major_ok() {
  if ! command -v pnpm >/dev/null 2>&1; then
    return 1
  fi
  local ver major
  ver="$(pnpm --version)"
  major="${ver%%.*}"
  [[ "$major" =~ ^[0-9]+$ ]] && (( major >= 11 ))
}

read_package_manager_spec() {
  local pkg="${1:-package.json}"
  if [[ ! -f "$pkg" ]]; then
    return 0
  fi
  node -e '
const fs = require("fs");
try {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const spec = pkg.packageManager;
  if (typeof spec === "string") process.stdout.write(spec.split("+")[0]);
} catch {}
'
}

resolve_pnpm_spec() {
  if [[ -n "$PNPM_SPEC" ]]; then
    printf '%s' "$PNPM_SPEC"
    return 0
  fi
  local spec
  spec="$(read_package_manager_spec)"
  if [[ -n "$spec" ]]; then
    printf '%s' "$spec"
    return 0
  fi
  printf '%s' 'pnpm@11.5.2'
}

corepack_bin() {
  if command -v corepack >/dev/null 2>&1; then
    command -v corepack
    return 0
  fi
  local node_bin node_dir candidate
  node_bin="$(command -v node || true)"
  if [[ -z "$node_bin" ]]; then
    return 1
  fi
  node_dir="$(dirname "$node_bin")"
  candidate="${node_dir}/corepack"
  if [[ -x "$candidate" ]]; then
    printf '%s' "$candidate"
    return 0
  fi
  return 1
}

try_corepack() {
  local corepack spec
  corepack="$(corepack_bin || true)"
  if [[ -z "$corepack" ]]; then
    return 1
  fi
  spec="$(resolve_pnpm_spec)"
  "$corepack" enable
  "$corepack" prepare "$spec" --activate
  pnpm_major_ok
}

run_pnpm() {
  if [[ -n "${ENSURE_PNPM_USE_NPM_EXEC:-}" ]]; then
    local spec
    spec="$(resolve_pnpm_spec)"
    export CI="${CI:-true}"
    exec npm exec --yes "$spec" -- "$@"
  fi
  export CI="${CI:-true}"
  exec pnpm "$@"
}

ensure_pnpm() {
  if pnpm_major_ok; then
    return 0
  fi

  if try_corepack; then
    return 0
  fi

  if command -v npm >/dev/null 2>&1; then
    echo "ensure-pnpm: pnpm not on PATH — using npm exec $(resolve_pnpm_spec) (enable corepack for a global shim)" >&2
    ENSURE_PNPM_USE_NPM_EXEC=1
    return 0
  fi

  echo "ensure-pnpm: pnpm is not installed (install Node.js >= 24, run corepack enable, or see https://pnpm.io/installation)" >&2
  return 1
}

ensure_pnpm

if [[ $# -eq 0 ]]; then
  if [[ -n "${ENSURE_PNPM_USE_NPM_EXEC:-}" ]]; then
    export CI="${CI:-true}"
    npm exec --yes "$(resolve_pnpm_spec)" --version
  fi
  exit 0
fi

run_pnpm "$@"

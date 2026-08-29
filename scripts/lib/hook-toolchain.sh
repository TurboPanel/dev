# Pre-commit toolchain bootstrap for TurboPanel dev checkouts.
# Source after ROOT (or the target repo root) is set. Fails fast unless
# TURBOPANEL_SKIP_HOOK_TESTS is set (checked by the hook before sourcing).

# Relative path from vendor/deno/bin/ to the current Deno binary symlink target.
DENO_BIN_CURRENT_REL='../current/deno'

# Resolve the turbopanel/dev checkout (hosts paths.sh, runtime.sh, …).
# Prefer ROOT from the calling pre-commit (never trust $0 when this file is
# sourced — $0 stays the hook path, so dirname walks out of the repo).
tp_hook_dev_checkout() {
  if [ -n "${TURBOPANEL_DEV_CHECKOUT:-}" ]; then
    printf '%s' "$TURBOPANEL_DEV_CHECKOUT"
    return 0
  fi
  if [ -n "${ROOT:-}" ]; then
    if [ -f "$ROOT/package.json" ] && grep -q '"@turbopanel/dev"' "$ROOT/package.json" 2>/dev/null; then
      printf '%s' "$ROOT"
      return 0
    fi
    if [ -f "$ROOT/../dev/package.json" ] && grep -q '"@turbopanel/dev"' "$ROOT/../dev/package.json" 2>/dev/null; then
      CDPATH= cd -- "$ROOT/../dev" && pwd
      return 0
    fi
  fi
  printf '%s/dev' "${TURBOPANEL_DEV_ROOT:-$HOME}"
}

tp_hook_source_dev_lib() {
  _hsdl_name=$1
  _hsdl_dev=$(tp_hook_dev_checkout)
  if [ ! -f "$_hsdl_dev/scripts/lib/$_hsdl_name" ]; then
    tp_hook_toolchain_fail \
      "dev checkout not found at ${_hsdl_dev} — clone TurboPanel/dev and run ./console"
  fi
  # shellcheck source=/dev/null
  . "$_hsdl_dev/scripts/lib/$_hsdl_name"
}

tp_hook_toolchain_fail() {
  echo "pre-commit: $*" >&2
  echo "pre-commit: or set TURBOPANEL_SKIP_HOOK_TESTS=1 to bypass validation (secret scan still runs)" >&2
  exit 1
}

# Bootstrap pinned Node + Corepack pnpm (Corepack is installed via vendored npm
# on Node 25+) and ensure node_modules for REPO_ROOT.
tp_hook_ensure_pnpm_toolchain() {
  _hpt_root=$1
  [ -n "$_hpt_root" ] || tp_hook_toolchain_fail "internal error: repo root required"

  tp_hook_source_dev_lib paths.sh
  tp_hook_source_dev_lib privileges.sh
  tp_hook_source_dev_lib packages.sh
  tp_hook_source_dev_lib runtime.sh

  if ! tp_ensure_node_runtime; then
    tp_hook_toolchain_fail "failed to install pinned Node — run ./console from the dev checkout"
  fi
  tp_export_node_path
  if ! tp_ensure_corepack_pnpm "$_hpt_root"; then
    tp_hook_toolchain_fail "failed to provision pnpm — run ./console from the dev checkout"
  fi

  if [ ! -d "$_hpt_root/node_modules" ]; then
    tp_info "Installing JS dependencies for pre-commit…"
    if [ -f "$_hpt_root/pnpm-lock.yaml" ]; then
      COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "$PNPM_BIN" install --dir "$_hpt_root" --frozen-lockfile \
        || COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "$PNPM_BIN" install --dir "$_hpt_root"
    else
      COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "$PNPM_BIN" install --dir "$_hpt_root"
    fi
  fi

  if [ ! -d "$_hpt_root/node_modules" ]; then
    tp_hook_toolchain_fail "node_modules/ is still missing after pnpm install"
  fi
  if [ ! -x "$PNPM_BIN" ]; then
    tp_hook_toolchain_fail "pnpm is not executable at ${PNPM_BIN}"
  fi
  export PNPM_BIN
}

tp_hook_deno_arch_triple() {
  case "$(uname -m)" in
    aarch64|arm64) printf '%s' 'aarch64-unknown-linux-gnu' ;;
    x86_64|amd64) printf '%s' 'x86_64-unknown-linux-gnu' ;;
    *)
      tp_hook_toolchain_fail "unsupported architecture for Deno bootstrap: $(uname -m)"
      ;;
  esac
}

tp_hook_bootstrap_vendored_deno() {
  _hbvd_version=$1
  _hbvd_runtimes=${TURBOPANEL_RUNTIMES_DIR:-/opt/turbopanel/vendor}
  _hbvd_versioned="$_hbvd_runtimes/deno/$_hbvd_version/deno"
  _hbvd_arch=$(tp_hook_deno_arch_triple)
  _hbvd_asset="deno-${_hbvd_arch}.zip"
  _hbvd_url="https://dl.deno.land/release/v${_hbvd_version}/${_hbvd_asset}"
  _hbvd_tmp=$(mktemp -d)

  if ! curl -fsSL --proto "=https" --proto-redir "=https" -o "$_hbvd_tmp/$_hbvd_asset" "$_hbvd_url"; then
    rm -rf "$_hbvd_tmp"
    tp_hook_toolchain_fail "failed to download Deno v${_hbvd_version} from ${_hbvd_url}"
  fi
  mkdir -p "$(dirname "$_hbvd_versioned")"
  if ! python3 - "$_hbvd_tmp/$_hbvd_asset" "$_hbvd_versioned" <<'PY'
import shutil, sys, tempfile, zipfile
from pathlib import Path

archive, dest = Path(sys.argv[1]), Path(sys.argv[2])
dest.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="deno-zip-") as tmp:
    tmp_path = Path(tmp)
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(tmp_path)
    candidates = list(tmp_path.rglob("deno"))
    if not candidates:
        raise SystemExit("deno binary not found in release zip")
    shutil.copy2(candidates[0], dest)
dest.chmod(0o755)
PY
  then
    rm -rf "$_hbvd_tmp"
    tp_hook_toolchain_fail "failed to extract Deno release zip"
  fi
  rm -rf "$_hbvd_tmp"

  if [ "$(id -u)" -eq 0 ] || [ -w "$_hbvd_runtimes" ] 2>/dev/null; then
    ln -sfn "$_hbvd_version" "$_hbvd_runtimes/deno/current"
    mkdir -p "$_hbvd_runtimes/deno/bin"
    ln -sfn "$DENO_BIN_CURRENT_REL" "$_hbvd_runtimes/deno/bin/deno"
  elif command -v sudo >/dev/null 2>&1; then
    sudo ln -sfn "$_hbvd_version" "$_hbvd_runtimes/deno/current"
    sudo mkdir -p "$_hbvd_runtimes/deno/bin"
    sudo ln -sfn "$DENO_BIN_CURRENT_REL" "$_hbvd_runtimes/deno/bin/deno"
  fi
}

# True when vendor/deno/current resolves to the pinned version directory.
#
# Uses `cd -P` + `pwd` (POSIX) instead of `readlink -f`, which is not a POSIX
# interface: on hosts without it the command prints nothing, and an equality
# check between two empty strings would succeed spuriously — waving through the
# exact stale `current` this guard exists to catch.
tp_hook_deno_current_is_pinned() {
  _hdcp_runtimes=$1
  _hdcp_version=$2
  [ -x "$VENDORED_DENO_BIN" ] || return 1
  _hdcp_phys=$(CDPATH= cd -P -- "$_hdcp_runtimes/deno/current" 2>/dev/null && pwd) || return 1
  [ -n "$_hdcp_phys" ] || return 1
  [ "${_hdcp_phys##*/}" = "$_hdcp_version" ]
}

# Export a specific Deno binary (plus its directory on PATH).
#
# Deliberately not `tp_export_deno_path`: that helper re-prefers
# vendor/deno/current whenever it is executable, which would put back the very
# stale runtime the caller resolved away from.
tp_hook_export_deno_bin() {
  DENO_BIN=$1
  export DENO_BIN
  PATH="$(dirname "$DENO_BIN"):${PATH:-}"
  export PATH
}

# Install pinned Deno under vendor when absent; run the pinned version, never a
# superseded vendor/deno/current.
tp_hook_ensure_deno_toolchain() {
  tp_hook_source_dev_lib paths.sh
  tp_hook_source_dev_lib runtime.sh

  _hdt_version=$DENO_VERSION
  _hdt_runtimes=$TURBOPANEL_RUNTIMES_DIR
  _hdt_versioned="$_hdt_runtimes/deno/$_hdt_version/deno"

  # Short-circuit on the pinned path, not merely on `current` being executable:
  # a `current` left pointing at a superseded version is exactly what a pin bump
  # has to repair, so only take the fast path when `current` already resolves to
  # the pin. Otherwise fall through and relink below.
  if [ -x "$_hdt_versioned" ] &&
    tp_hook_deno_current_is_pinned "$_hdt_runtimes" "$_hdt_version"; then
    tp_export_deno_path
    return 0
  fi

  if [ -x "$_hdt_versioned" ]; then
    if [ "$(id -u)" -eq 0 ] || [ -w "$_hdt_runtimes" ] 2>/dev/null; then
      ln -sfn "$_hdt_version" "$_hdt_runtimes/deno/current"
      mkdir -p "$_hdt_runtimes/deno/bin"
      ln -sfn "$DENO_BIN_CURRENT_REL" "$_hdt_runtimes/deno/bin/deno"
    elif command -v sudo >/dev/null 2>&1; then
      sudo ln -sfn "$_hdt_version" "$_hdt_runtimes/deno/current"
      sudo mkdir -p "$_hdt_runtimes/deno/bin"
      sudo ln -sfn "$DENO_BIN_CURRENT_REL" "$_hdt_runtimes/deno/bin/deno"
    fi
  elif command -v curl >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
    tp_hook_bootstrap_vendored_deno "$_hdt_version"
  elif command -v deno >/dev/null 2>&1; then
    tp_hook_export_deno_bin "$(command -v deno)"
    return 0
  else
    tp_hook_toolchain_fail \
      "Deno is not installed — run ./console stack converge, or install curl + python3 to bootstrap vendored Deno"
  fi

  # Pin first. `current` is only usable once it is known to resolve to the pin;
  # when the relink could not run (no root, no sudo) run the pinned binary
  # directly rather than silently exporting the stale `current`.
  if [ -x "$_hdt_versioned" ]; then
    if tp_hook_deno_current_is_pinned "$_hdt_runtimes" "$_hdt_version"; then
      tp_export_deno_path
      return 0
    fi
    tp_hook_export_deno_bin "$_hdt_versioned"
    return 0
  fi

  if command -v deno >/dev/null 2>&1; then
    tp_hook_export_deno_bin "$(command -v deno)"
    return 0
  fi

  tp_hook_toolchain_fail \
    "Deno v${_hdt_version} is not available — run ./console stack converge"
}

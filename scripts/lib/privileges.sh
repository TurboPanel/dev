# POSIX sh helpers for privilege checks and sudo re-exec.
# Source from repo scripts: . "$SCRIPT_DIR/scripts/lib/privileges.sh"

if [ -t 1 ]; then
  _TP_RED=$(printf '\033[31m')
  _TP_YELLOW=$(printf '\033[33m')
  _TP_GREEN=$(printf '\033[32m')
  _TP_CYAN=$(printf '\033[36m')
  _TP_RESET=$(printf '\033[0m')
else
  _TP_RED=
  _TP_YELLOW=
  _TP_GREEN=
  _TP_CYAN=
  _TP_RESET=
fi

tp_info() {
  printf '%s→%s %s\n' "$_TP_CYAN" "$_TP_RESET" "$*"
}

tp_success() {
  printf '%s✓%s %s\n' "$_TP_GREEN" "$_TP_RESET" "$*"
}

tp_warn() {
  printf '%s⚠%s %s\n' "$_TP_YELLOW" "$_TP_RESET" "$*"
}

tp_error() {
  printf '%s✗%s %s\n' "$_TP_RED" "$_TP_RESET" "$*" >&2
}

# True when prompts can use the controlling terminal (including curl | sh from a TTY).
tp_is_interactive() {
  if [ -t 0 ]; then
    return 0
  fi
  [ -r /dev/tty ] && [ -w /dev/tty ] 2>/dev/null
}

# Read y/n from the controlling terminal. Default n unless the second argument is y.
tp_read_tty_yn() {
  _rty_prompt=$1
  _rty_default=${2:-n}
  if [ "$_rty_default" = y ]; then
    printf '%s [Y/n]: ' "$_rty_prompt" >/dev/tty
  else
    printf '%s [y/N]: ' "$_rty_prompt" >/dev/tty
  fi
  IFS= read -r _rty_answer </dev/tty || true
  _rty_answer=$(tp_trim_whitespace "$_rty_answer")
  case $_rty_answer in
    y|Y|yes|Yes|YES) return 0 ;;
    n|N|no|No|NO) return 1 ;;
    '')
      [ "$_rty_default" = y ]
      return $?
      ;;
    *) return 1 ;;
  esac
}

tp_trim_whitespace() {
  _tw=$1
  while [ -n "$_tw" ]; do
    case $_tw in
      ' '*) _tw=${_tw#?} ;;
      *' ') _tw=${_tw%?} ;;
      *'	'*) _tw=${_tw%?} ;;
      '	'*) _tw=${_tw#?} ;;
      *) break ;;
    esac
  done
  printf '%s' "$_tw"
}

tp_can_write_path() {
  _cwp_path=$1
  if [ -d "$_cwp_path" ]; then
    [ -w "$_cwp_path" ]
    return $?
  fi

  _cwp_parent=$(dirname "$_cwp_path")
  if [ -d "$_cwp_parent" ]; then
    [ -w "$_cwp_parent" ]
    return $?
  fi

  _cwp_dir="$_cwp_parent"
  while [ "$_cwp_dir" != "/" ] && [ ! -d "$_cwp_dir" ]; do
    _cwp_dir=$(dirname "$_cwp_dir")
  done
  [ -d "$_cwp_dir" ] && [ -w "$_cwp_dir" ]
}

tp_resolve_script() {
  _rs=$0
  case $_rs in
    */*)
      _rs=$(CDPATH= cd -- "$(dirname "$_rs")" && pwd)/$(basename "$_rs")
      ;;
    *) ;;
  esac
  printf '%s' "$_rs"
}

tp_ensure_privileges() {
  _ep_root=$1
  shift
  if [ "$(id -u)" -eq 0 ]; then
    return 0
  fi
  if tp_can_write_path "$_ep_root"; then
    return 0
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    tp_error "Write access to ${_ep_root} requires root privileges, but sudo is not installed."
    exit 1
  fi
  tp_info "Administrator privileges required for ${_ep_root}"
  _ep_script=$(tp_resolve_script)
  exec sudo -E sh "$_ep_script" "$@"
}

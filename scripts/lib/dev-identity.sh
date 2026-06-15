# Resolve co-located dev developer identity from session UID + passwd.
# Never trust USER, LOGNAME, or other spoofable shell env vars.
# On success sets TP_DEV_USER, TP_DEV_UID, TP_DEV_GID and returns 0.

tp_resolve_dev_identity() {
  TP_DEV_USER=
  TP_DEV_UID=
  TP_DEV_GID=

  _trdi_uid=$(id -u 2>/dev/null) || return 1

  if [ "$_trdi_uid" -eq 0 ]; then
    _trdi_sudo_user=${SUDO_USER:-}
    [ -n "$_trdi_sudo_user" ] || return 1
    [ "$_trdi_sudo_user" != root ] || return 1
    _trdi_line=$(getent passwd "$_trdi_sudo_user" 2>/dev/null) || return 1
    [ -n "$_trdi_line" ] || return 1
    TP_DEV_USER=$_trdi_sudo_user
    TP_DEV_UID=$(printf '%s\n' "$_trdi_line" | cut -d: -f3)
    TP_DEV_GID=$(printf '%s\n' "$_trdi_line" | cut -d: -f4)
    [ -n "$TP_DEV_UID" ] && [ -n "$TP_DEV_GID" ] || return 1
    return 0
  fi

  _trdi_line=$(getent passwd "$_trdi_uid" 2>/dev/null) || return 1
  [ -n "$_trdi_line" ] || return 1
  TP_DEV_USER=$(printf '%s\n' "$_trdi_line" | cut -d: -f1)
  [ -n "$TP_DEV_USER" ] || return 1
  [ "$TP_DEV_USER" != root ] || return 1
  TP_DEV_UID=$_trdi_uid
  TP_DEV_GID=$(id -g 2>/dev/null) || return 1
  return 0
}

tp_require_dev_identity() {
  if tp_resolve_dev_identity; then
    return 0
  fi
  tp_error "Cannot resolve developer identity from session (refusing spoofable USER/LOGNAME)"
  exit 1
}

#!/bin/sh
# TurboPanel development VM login banner (Vagrant guest).
#
# Official T-mark geometry matches website/ui brand SVGs (green bars + blue T).
# The lockup lettering is "urboPanel" — the mark is the T.
#
# Printed via pam_motd (/etc/motd.d), not a TTY check: PAM captures stdout.
# Future: production host MOTD lives in the daemon Ansible roles.
#
# After editing, refresh the installed banner:
#   sudo sh ~/dev/scripts/guest/install-motd.sh
# or: vagrant provision --provision-with guest-motd

set -eu

tp_motd_setup_colors() {
  # Honor NO_COLOR; do not gate on isatty (pam_motd is not a TTY).
  if [ -n "${NO_COLOR-}" ] || [ "${TERM-}" = "dumb" ]; then
    TP_G=
    TP_B=
    TP_MUTED=
    TP_TEXT=
    TP_BOLD=
    TP_ITAL=
    TP_RST=
    return 0
  fi
  _esc=$(printf '\033')
  # Brand: green #3DD68C / blue #3366CC (truecolor; ignored if unsupported).
  TP_G="${_esc}[38;2;61;214;140m"
  TP_B="${_esc}[38;2;51;102;204m"
  TP_MUTED="${_esc}[38;2;122;132;148m"
  TP_TEXT="${_esc}[38;2;236;240;246m"
  TP_BOLD="${_esc}[1m"
  TP_ITAL="${_esc}[3m"
  TP_RST="${_esc}[0m"
}

tp_motd_os_pretty() {
  if [ -r /etc/os-release ]; then
    # Isolate assignments from os-release.
    _pretty=$(
      # shellcheck disable=SC1091
      . /etc/os-release
      printf '%s' "${PRETTY_NAME-}"
    )
    if [ -n "$_pretty" ]; then
      printf '%s' "$_pretty"
      return 0
    fi
  fi
  printf '%s' "Debian GNU/Linux"
}

tp_motd_setup_colors

_host=$(uname -n 2>/dev/null || printf '%s' "turbopanel-dev")
_os=$(tp_motd_os_pretty)

# Rasterized from the official 628×370 T-mark (half-blocks). Colors wrap each
# run so a partial copy-paste still resets.
printf '\n'
printf '     %s████%s %s█████%s %s▄████████████████████████████▀%s\n' \
  "$TP_G" "$TP_RST" "$TP_G" "$TP_RST" "$TP_B" "$TP_RST"
printf '    %s████%s %s█████▀%s%s▄████████████████████████████▀%s\n' \
  "$TP_G" "$TP_RST" "$TP_G" "$TP_RST" "$TP_B" "$TP_RST"
printf '   %s████%s %s█████▀%s%s▄████████████████████████████▀%s\n' \
  "$TP_G" "$TP_RST" "$TP_G" "$TP_RST" "$TP_B" "$TP_RST"
printf '  %s▀▀▀▀%s %s▀▀▀▀▀▀%s %s▀▀▀▀▀▀▀███████████▀▀▀▀▀▀▀▀▀▀▀%s\n' \
  "$TP_G" "$TP_RST" "$TP_G" "$TP_RST" "$TP_B" "$TP_RST"
printf '                    %s███████████%s\n' "$TP_B" "$TP_RST"
printf '                   %s▄██████████%s    %s%s%surboPanel%s\n' \
  "$TP_B" "$TP_RST" "$TP_BOLD" "$TP_ITAL" "$TP_TEXT" "$TP_RST"
printf '                  %s▄██████████%s\n' "$TP_B" "$TP_RST"
printf '                 %s▄██████████▀%s\n' "$TP_B" "$TP_RST"
printf '                %s▄██████████▀%s\n' "$TP_B" "$TP_RST"
printf '               %s▄██████████▀%s\n' "$TP_B" "$TP_RST"
printf '              %s▄██████████▀%s\n' "$TP_B" "$TP_RST"

printf '\n'
printf '  %sDevelopment environment%s  %s·%s  %sPrivate alpha%s\n' \
  "$TP_TEXT" "$TP_RST" "$TP_MUTED" "$TP_RST" "$TP_G" "$TP_RST"
printf '  %s─────────────────────────────────────────────%s\n' "$TP_MUTED" "$TP_RST"
printf '\n'
printf '  Run  %s%s~/dev/console%s\n' "$TP_BOLD" "$TP_G" "$TP_RST"
printf '  to enter the developer console and start the stack.\n'
printf '\n'
printf '  Then open  %s%shttps://localhost:8443%s  on the host.\n' \
  "$TP_BOLD" "$TP_B" "$TP_RST"
printf '\n'
printf '  %s%s  ·  %s%s\n' "$TP_MUTED" "$_host" "$_os" "$TP_RST"
printf '\n'

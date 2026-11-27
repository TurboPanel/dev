# TurboPanel development VM: on the dev user's first interactive login, ask for a
# password. The panel's first sign-in checks this account's password through PAM.
# scripts/lima-guest-setup.sh installs this file as
# /etc/profile.d/turbopanel-dev-password.sh with the dev user's name written in
# place of the marker below. Sourced by sh, bash and zsh login shells, so it
# stays plain POSIX, never exits or sets options, and unsets what it creates.
if [ "$(id -un 2>/dev/null)" = "@DEV_USER@" ]; then
  case $- in
    *i*)
      if [ -t 0 ] && [ -t 1 ]; then
        _tp_pw_user=$(id -un)
        _tp_pw_state=$(passwd -S "$_tp_pw_user" 2>/dev/null | awk '{print $2}')
        case "$_tp_pw_state" in
          L | NP)
            echo "TurboPanel development VM: your account has no password yet."
            echo "The panel's first sign-in checks it (SSH does not accept passwords)."
            # A locked account cannot change its own password with plain passwd.
            # The empty INT trap lets Ctrl-C stop passwd without ending the login
            # shell's startup files.
            trap : INT
            sudo passwd "$_tp_pw_user" ||
              echo "Password not set. Set it later with: sudo passwd $_tp_pw_user"
            trap - INT
            ;;
          *) ;;
        esac
      fi
      ;;
    *) ;;
  esac
fi
unset _tp_pw_user _tp_pw_state

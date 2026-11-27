# TurboPanel development VM: on the first interactive login, ask the dev user to
# set a password. The panel's first sign-in checks this account's password
# through PAM. Installed as /etc/profile.d/turbopanel-dev-password.sh by
# scripts/lima-guest-setup.sh. Sourced by sh, bash and zsh login shells, so it
# stays plain POSIX, never exits or sets options, and unsets what it creates.
if [ "$(id -u 2>/dev/null)" != 0 ]; then
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
            sudo passwd "$_tp_pw_user" ||
              echo "Password not set. Set it later with: sudo passwd $_tp_pw_user"
            ;;
          *) ;;
        esac
      fi
      ;;
    *) ;;
  esac
fi
unset _tp_pw_user _tp_pw_state

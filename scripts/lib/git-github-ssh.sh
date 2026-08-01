# GitHub SSH key generation, git commit signing, and SSH auth verification.
# Source after privileges.sh (tp_info, tp_trim_whitespace).

SSH_KEY="${HOME}/.ssh/id_ed25519"
SSH_PUB="${HOME}/.ssh/id_ed25519.pub"
SSH_DIR="${HOME}/.ssh"
KNOWN_HOSTS="${SSH_DIR}/known_hosts"
GIT_ALLOWED_SIGNERS="${HOME}/.config/git/allowed_signers"
GITHUB_SSH_STAMP="${HOME}/.config/turbopanel/git-github-ssh.stamp"

tp_read_tty_line() {
  _rtl_prompt=$1
  _rtl_default=$2
  if [ -n "$_rtl_default" ]; then
    printf '%s [%s]: ' "$_rtl_prompt" "$_rtl_default" >/dev/tty
  else
    printf '%s: ' "$_rtl_prompt" >/dev/tty
  fi
  IFS= read -r _rtl_answer </dev/tty || true
  _rtl_answer=$(tp_trim_whitespace "$_rtl_answer")
  if [ -z "$_rtl_answer" ] && [ -n "$_rtl_default" ]; then
    _rtl_answer=$_rtl_default
  fi
  printf '%s' "$_rtl_answer"
}

tp_ensure_openssh_client() {
  if command -v ssh-keygen >/dev/null 2>&1 && command -v ssh >/dev/null 2>&1; then
    return 0
  fi

  tp_info "openssh-client is required for GitHub SSH"
  _apt_lock_opt="-o DPkg::Lock::Timeout=300"
  if [ "$(id -u)" -eq 0 ]; then
    apt-get $_apt_lock_opt update -qq
    DEBIAN_FRONTEND=noninteractive apt-get $_apt_lock_opt install -y openssh-client
  elif command -v sudo >/dev/null 2>&1; then
    tp_info "Administrator privileges required to install openssh-client"
    sudo apt-get $_apt_lock_opt update -qq
    DEBIAN_FRONTEND=noninteractive sudo apt-get $_apt_lock_opt install -y openssh-client
  else
    tp_error "openssh-client is not installed and sudo is not available."
    exit 1
  fi

  if ! command -v ssh-keygen >/dev/null 2>&1; then
    tp_error "ssh-keygen is still not available after installing openssh-client."
    exit 1
  fi
}

tp_ensure_ssh_dir() {
  if [ ! -d "$SSH_DIR" ]; then
    mkdir -p "$SSH_DIR"
    chmod 700 "$SSH_DIR"
  fi
}

tp_github_known_hosts_ready() {
  [ -f "$KNOWN_HOSTS" ] || return 1
  ssh-keygen -F github.com -f "$KNOWN_HOSTS" >/dev/null 2>&1
}

tp_ensure_github_known_hosts() {
  tp_ensure_ssh_dir
  if tp_github_known_hosts_ready; then
    return 0
  fi
  tp_info "Adding github.com to SSH known_hosts"
  ssh-keyscan -t ed25519 github.com >>"$KNOWN_HOSTS" 2>/dev/null || true
  chmod 600 "$KNOWN_HOSTS" 2>/dev/null || true
}

tp_github_ssh_auth_works() {
  tp_ensure_github_known_hosts
  _gsaw_out=$(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -T git@github.com 2>&1) || true
  case $_gsaw_out in
    *"successfully authenticated"*) return 0 ;;
    *"You've successfully authenticated"*) return 0 ;;
    *) return 1 ;;
  esac
}

tp_git_signing_configured() {
  [ "$(git config --global gpg.format 2>/dev/null)" = "ssh" ] || return 1
  [ "$(git config --global commit.gpgsign 2>/dev/null)" = "true" ] || return 1
  [ "$(git config --global tag.gpgSign 2>/dev/null)" = "true" ] || return 1
  [ -n "$(git config --global user.signingkey 2>/dev/null)" ] || return 1
  [ -f "$GIT_ALLOWED_SIGNERS" ] || return 1
  return 0
}

tp_read_github_ssh_stamp() {
  if [ -f "$GITHUB_SSH_STAMP" ]; then
    tr -d '\n\r' <"$GITHUB_SSH_STAMP"
  fi
}

tp_write_github_ssh_stamp() {
  _wgs_name=$1
  _wgs_email=$2
  mkdir -p "$(dirname "$GITHUB_SSH_STAMP")"
  printf '%s:%s\n' "$_wgs_name" "$_wgs_email" >"$GITHUB_SSH_STAMP"
}

tp_configure_git_signing() {
  _cgs_email=$1
  mkdir -p "$(dirname "$GIT_ALLOWED_SIGNERS")"
  printf '%s %s\n' "$_cgs_email" "$(cat "$SSH_PUB")" >"$GIT_ALLOWED_SIGNERS"

  git config --global user.signingkey "$SSH_PUB"
  git config --global gpg.format ssh
  git config --global commit.gpgsign true
  git config --global tag.gpgSign true
  git config --global gpg.ssh.allowedSignersFile "$GIT_ALLOWED_SIGNERS"
}

tp_generate_ssh_key() {
  _gsk_email=$1
  if [ -f "$SSH_KEY" ]; then
    return 0
  fi

  tp_info "Generating SSH key at ${SSH_KEY}"
  ssh-keygen -t ed25519 -f "$SSH_KEY" -N "" -C "$_gsk_email"
  chmod 600 "$SSH_KEY"
  chmod 644 "$SSH_PUB"
}

tp_show_github_ssh_key_instructions() {
  echo
  tp_info "Add this public key to GitHub (Settings → SSH and GPG keys → New SSH key):"
  echo
  cat "$SSH_PUB"
  echo
  tp_info "Title suggestion: TurboPanel dev ($(hostname 2>/dev/null || echo dev))"
  echo
  printf 'Press Enter after the key is saved on GitHub… ' >/dev/tty
  IFS= read -r _ </dev/tty || true
  echo
}

tp_github_repo_access_works() {
  _graw_repo=$1
  [ -n "$_graw_repo" ] || return 0
  git ls-remote "git@github.com:${_graw_repo}.git" HEAD >/dev/null 2>&1
}

tp_verify_github_repo_access() {
  _vgra_repo=$1
  [ -n "$_vgra_repo" ] || return 0
  tp_info "Verifying git read access to ${_vgra_repo}…"
  if ! tp_github_repo_access_works "$_vgra_repo"; then
    tp_error "Cannot read git@github.com:${_vgra_repo}.git"
    tp_error "Check repository access for your GitHub account."
    exit 1
  fi
  tp_success "Repository access OK"
}

tp_github_ssh_fully_ready() {
  _gfr_repo=$1
  [ -f "$SSH_KEY" ] || return 1
  [ -n "$(git config --global user.name 2>/dev/null)" ] || return 1
  [ -n "$(git config --global user.email 2>/dev/null)" ] || return 1
  tp_git_signing_configured || return 1
  tp_github_ssh_auth_works || return 1
  tp_github_repo_access_works "$_gfr_repo" || return 1
  return 0
}

tp_prompt_git_identity() {
  _pgi_name=$1
  _pgi_email=$2

  echo
  tp_info "GitHub SSH setup — enter your git username and email"
  tp_info "A new ~/.ssh/id_ed25519 key will be generated if one is not already present"
  echo

  while [ -z "$_pgi_name" ]; do
    _pgi_name=$(tp_read_tty_line "Git username (git config user.name)" "")
    _pgi_name=$(tp_trim_whitespace "$_pgi_name")
  done

  while [ -z "$_pgi_email" ]; do
    _pgi_email=$(tp_read_tty_line "Git email (git config user.email)" "")
    _pgi_email=$(tp_trim_whitespace "$_pgi_email")
  done

  printf '%s:%s' "$_pgi_name" "$_pgi_email"
}

# Idempotently wire core.hooksPath=.githooks for this checkout (no-op outside a
# git work tree or when .githooks/pre-commit is missing).
tp_ensure_git_hooks_path() {
  _eghp_root=${1:-}
  if [ -z "$_eghp_root" ]; then
    return 0
  fi
  if [ ! -f "$_eghp_root/.githooks/pre-commit" ]; then
    return 0
  fi
  if ! git -C "$_eghp_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 0
  fi

  _eghp_current=$(git -C "$_eghp_root" config --local --get core.hooksPath 2>/dev/null || true)
  if [ "$_eghp_current" != ".githooks" ]; then
    git -C "$_eghp_root" config --local core.hooksPath .githooks
  fi

  chmod +x "$_eghp_root"/.githooks/* 2>/dev/null || true
}

# Wire core.hooksPath for every co-located development checkout (dev + platform
# repos). Skips missing directories and repos without .githooks/pre-commit.
# LIB_DIR is the absolute path to scripts/lib inside the dev checkout (optional).
tp_ensure_all_git_hooks_paths() {
  _eahhp_lib=$1
  if [ -z "$_eahhp_lib" ]; then
    _eahhp_lib="${TURBOPANEL_DEV_ROOT:-$HOME}/dev/scripts/lib"
  fi
  # shellcheck source=scripts/lib/paths.sh
  . "$_eahhp_lib/paths.sh"

  for _eahhp_dir in dev daemon instance ui website; do
    _eahhp_root=$(tp_platform_repo_path "$_eahhp_dir")
    if [ ! -d "$_eahhp_root" ]; then
      continue
    fi
    tp_ensure_git_hooks_path "$_eahhp_root"
  done
}

tp_ensure_github_ssh() {
  _egs_repo=$1
  command -v git >/dev/null 2>&1 || return 0

  tp_ensure_openssh_client
  tp_ensure_ssh_dir

  if tp_github_ssh_fully_ready "$_egs_repo"; then
    return 0
  fi

  _egs_name=$(git config --global user.name 2>/dev/null || true)
  _egs_email=$(git config --global user.email 2>/dev/null || true)
  _egs_stamp=$(tp_read_github_ssh_stamp)
  if [ -n "$_egs_stamp" ] && [ "$_egs_stamp" != "${_egs_stamp#*:}" ]; then
    if [ -z "$_egs_name" ]; then
      _egs_name=${_egs_stamp%%:*}
    fi
    if [ -z "$_egs_email" ]; then
      _egs_email=${_egs_stamp#*:}
    fi
  fi

  if [ -z "$_egs_name" ] || [ -z "$_egs_email" ]; then
    if ! tp_is_interactive; then
      tp_error "Git identity is not configured and no controlling terminal is available."
      tp_error "Run sh scripts/develop.sh from an interactive terminal to set up SSH keys and git signing."
      exit 1
    fi
    _egs_identity=$(tp_prompt_git_identity "$_egs_name" "$_egs_email")
    _egs_name=${_egs_identity%%:*}
    _egs_email=${_egs_identity#*:}
  fi

  tp_generate_ssh_key "$_egs_email"

  git config --global user.name "$_egs_name"
  git config --global user.email "$_egs_email"
  tp_configure_git_signing "$_egs_email"
  tp_write_github_ssh_stamp "$_egs_name" "$_egs_email"
  tp_success "Git identity and SSH commit signing configured"

  if ! tp_github_ssh_auth_works; then
    if ! tp_is_interactive; then
      tp_error "GitHub SSH authentication failed and no controlling terminal is available."
      tp_error "Add ~/.ssh/id_ed25519.pub to your GitHub account and re-run develop.sh."
      exit 1
    fi
    tp_show_github_ssh_key_instructions
    if ! tp_github_ssh_auth_works; then
      tp_error "GitHub SSH authentication failed."
      tp_error "Confirm the public key above is saved on your GitHub account."
      exit 1
    fi
  fi

  tp_success "GitHub SSH authentication OK"
  tp_verify_github_repo_access "$_egs_repo"
}

case $(basename "$0") in
  git-github-ssh.sh)
    # shellcheck source=scripts/lib/privileges.sh
    . "$(CDPATH= cd -- "$(dirname "$0")" && pwd)/privileges.sh"
    tp_ensure_github_ssh "${1:-turbopanel/dev}"
    ;;
  *) ;;
esac

import { existsSync } from 'node:fs'

/** Profile file the Vagrantfile provisioner writes in the guest (also used by setup.sh). */
export const VAGRANT_GUEST_MARKER = '/etc/profile.d/turbopanel-vagrant.sh'

/**
 * True inside the Vagrant guest, where the host repos are mounted at
 * `$HOME/<repo>`. `TURBOPANEL_VAGRANT_GUEST_MARKER` exists only so tests can
 * point the check at another file (`scripts/lib/paths.sh` reads the same one).
 */
export function isVagrantGuest(): boolean {
  return existsSync(process.env.TURBOPANEL_VAGRANT_GUEST_MARKER?.trim() || VAGRANT_GUEST_MARKER)
}

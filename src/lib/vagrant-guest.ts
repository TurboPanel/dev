import { accessSync } from 'node:fs'

/** Profile file the Vagrantfile provisioner writes in the guest (also used by setup.sh). */
export const VAGRANT_GUEST_MARKER = '/etc/profile.d/turbopanel-vagrant.sh'

/**
 * True inside the Vagrant guest, where the host repos are mounted at
 * `$HOME/<repo>`. `TURBOPANEL_VAGRANT_GUEST_MARKER` exists only so tests can
 * point the check at another file (`scripts/lib/paths.sh` reads the same one).
 */
export function isVagrantGuest(): boolean {
  // accessSync, not existsSync: several suites mock existsSync around code that
  // resolves repo paths, and a mocked probe here would recurse into them.
  try {
    accessSync(process.env.TURBOPANEL_VAGRANT_GUEST_MARKER?.trim() || VAGRANT_GUEST_MARKER)
    return true
  } catch {
    return false
  }
}

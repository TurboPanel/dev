import { resolveDevRoot } from './paths.ts'
import { spawnSyncTrustedText } from './spawn-trusted.ts'

/**
 * Characters allowed in `TURBOPANEL_DEV_ROOT`. The value is written unquoted
 * into systemd `Environment=` lines, `KEY=VALUE` env files, a YAML vars file,
 * the dev Caddyfile `{$VAR}` placeholders and Ansible `-e key=value` pairs (which
 * split on whitespace), so spaces, quotes, `$`, `:`, `#`, `;` and other shell or
 * YAML metacharacters would break one of them. Keep to a portable path set.
 */
const SAFE_PATH_CHARS = /^[A-Za-z0-9._@+/-]+$/

/**
 * Character and shape rules for `TURBOPANEL_DEV_ROOT`; `null` when the value is
 * usable. No filesystem access: `tp_validate_dev_root` in `scripts/lib/paths.sh`
 * (run by `./console`) and the dev playbook check that the folder is readable or
 * creatable by the developer.
 */
export function devRootSyntaxError(value: string): string | null {
  if (!value.startsWith('/')) return 'must be an absolute path'
  if (value === '/') return 'must not be the filesystem root'
  if (!SAFE_PATH_CHARS.test(value)) {
    return 'may only contain letters, digits and . _ @ + - / (no spaces or shell characters)'
  }
  const segments = new Set(value.split('/'))
  if (segments.has('.') || segments.has('..')) {
    return 'must not contain . or .. segments'
  }
  return null
}

export class DevRootError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DevRootError'
  }
}

/**
 * Resolve the development source-repo root and refuse a value that would break
 * the files it is written into. Syntax only, so it is safe to call anywhere;
 * See {@link devRootSyntaxError} for where the folder itself is checked.
 */
export function resolveCheckedDevRoot(): string {
  const root = resolveDevRoot()
  const problem = devRootSyntaxError(root)
  if (problem) {
    throw new DevRootError(`TURBOPANEL_DEV_ROOT=${root} ${problem}.`)
  }
  return root
}

/**
 * The dev user's real home from passwd: HOME for git, ssh and pnpm in the
 * daemon's repo roles, which must not follow the root into a repo folder.
 * `null` when it cannot be resolved (the roles then fall back to the root).
 */
export function resolveDevHome(user: string): string | null {
  const result = spawnSyncTrustedText('getent', ['passwd', user], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0 || !result.stdout) return null
  const home = result.stdout.trim().split(':')[5]?.trim()
  return home?.startsWith('/') ? home : null
}

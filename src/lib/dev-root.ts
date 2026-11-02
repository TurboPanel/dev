import { accessSync, constants, statSync } from 'node:fs'
import { dirname } from 'node:path'
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

function nearestExistingDir(path: string): string | null {
  let current = path
  for (;;) {
    try {
      return statSync(current).isDirectory() ? current : null
    } catch {
      const parent = dirname(current)
      if (parent === current) return null
      current = parent
    }
  }
}

function canAccess(path: string, mode: number): boolean {
  try {
    accessSync(path, mode)
    return true
  } catch {
    return false
  }
}

/** Syntax rules only (no filesystem access); `null` when the value is usable. */
export function devRootSyntaxError(value: string): string | null {
  if (!value.startsWith('/')) return 'must be an absolute path'
  if (value === '/') return 'must not be the filesystem root'
  if (!SAFE_PATH_CHARS.test(value)) {
    return 'may only contain letters, digits and . _ @ + - / (no spaces or shell characters)'
  }
  const segments = value.split('/')
  if (segments.includes('.') || segments.includes('..')) {
    return 'must not contain . or .. segments'
  }
  return null
}

/**
 * Check a development source-repo root. It must pass {@link devRootSyntaxError}
 * and either be a directory the current user can read and enter, or be
 * creatable (its nearest existing parent is writable). `null` when usable.
 */
export function validateDevRoot(value: string): string | null {
  const syntax = devRootSyntaxError(value)
  if (syntax) return syntax
  const existing = nearestExistingDir(value)
  if (existing === null) return 'is not a directory and cannot be created'
  if (existing === value) {
    return canAccess(value, constants.R_OK | constants.X_OK)
      ? null
      : 'is not readable by the current user'
  }
  return canAccess(existing, constants.W_OK | constants.X_OK)
    ? null
    : `cannot be created: ${existing} is not writable by the current user`
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
 * `./console` (`tp_validate_dev_root`) and the dev playbook also check that the
 * folder is readable or creatable by the dev user.
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

import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB_DIR = join(HERE, '../../scripts/lib')

// A throwaway repo only: no global or system git config of the person running
// the test (no signing key, hooks path or identity).
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: GIT_ENV })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout
}

/** A throwaway checkout with a committed hook and a guide next to it. */
function makeCheckout(hookMode: number): string {
  const root = mkdtempSync(join(tmpdir(), 'tp-githooks-mode-'))
  dirs.push(root)
  git(root, ['init', '-q', '-b', 'trunk'])
  git(root, ['config', 'user.email', 'dev@example.invalid'])
  git(root, ['config', 'user.name', 'Dev'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  mkdirSync(join(root, '.githooks'))
  writeFileSync(join(root, '.githooks/pre-commit'), '#!/bin/sh\nexit 0\n')
  writeFileSync(join(root, '.githooks/AGENTS.md'), '# Hooks\n')
  writeFileSync(join(root, '.githooks/helper.sh'), '# sourced, not run\n')
  chmodSync(join(root, '.githooks/pre-commit'), 0o755)
  chmodSync(join(root, '.githooks/AGENTS.md'), 0o644)
  chmodSync(join(root, '.githooks/helper.sh'), 0o644)
  git(root, ['add', '.'])
  git(root, ['commit', '-q', '-m', 'seed'])
  chmodSync(join(root, '.githooks/pre-commit'), hookMode)
  return root
}

function ensureHooksPath(root: string): void {
  const result = spawnSync(
    'sh',
    [
      '-c',
      '. "$1/privileges.sh"; . "$1/git-github-ssh.sh"; tp_ensure_git_hooks_path "$2"',
      'sh',
      LIB_DIR,
      root,
    ],
    { encoding: 'utf8', env: GIT_ENV }
  )
  expect(result.status, result.stderr || result.stdout).toBe(0)
}

function mode(path: string): number {
  return statSync(path).mode & 0o777
}

describe('tp_ensure_git_hooks_path file modes', () => {
  test('makes only the pre-commit hook executable', () => {
    const root = makeCheckout(0o644)

    ensureHooksPath(root)

    expect(mode(join(root, '.githooks/pre-commit')) & 0o111).not.toBe(0)
    expect(mode(join(root, '.githooks/AGENTS.md'))).toBe(0o644)
    expect(mode(join(root, '.githooks/helper.sh'))).toBe(0o644)
    expect(git(root, ['config', '--local', '--get', 'core.hooksPath']).trim()).toBe('.githooks')
  })

  test('leaves a checkout clean when the hook is already executable', () => {
    const root = makeCheckout(0o755)

    ensureHooksPath(root)
    ensureHooksPath(root)

    expect(mode(join(root, '.githooks/pre-commit'))).toBe(0o755)
    expect(mode(join(root, '.githooks/AGENTS.md'))).toBe(0o644)
    expect(git(root, ['status', '--porcelain'])).toBe('')
  })

  test('does not touch a checkout without a pre-commit hook', () => {
    const root = makeCheckout(0o755)
    rmSync(join(root, '.githooks/pre-commit'))

    ensureHooksPath(root)

    expect(mode(join(root, '.githooks/AGENTS.md'))).toBe(0o644)
    expect(
      spawnSync('git', ['-C', root, 'config', '--local', '--get', 'core.hooksPath'], {
        encoding: 'utf8',
        env: GIT_ENV,
      }).stdout.trim()
    ).toBe('')
  })
})

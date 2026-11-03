import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { type SiblingRepo, siblingCheckout } from './sibling-checkout.ts'

const DEV_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const SIBLINGS: SiblingRepo[] = ['turbopanel', 'turbopaneld', 'ui', 'website']

// A throwaway repo only: no global or system config (so no signing key or
// hooks of the person running the test), a fixed identity, no signing.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Hook Test',
  GIT_AUTHOR_EMAIL: 'hook-test@example.invalid',
  GIT_COMMITTER_NAME: 'Hook Test',
  GIT_COMMITTER_EMAIL: 'hook-test@example.invalid',
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = GIT_ENV) {
  const res = spawnSync('git', args, { cwd, env, encoding: 'utf8' })
  expect(res.status, `git ${args.join(' ')}: ${res.stderr}`).toBe(0)
  return res.stdout
}

const temps: string[] = []
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Commit from a worktree while core.hooksPath is an absolute path to the main
 * checkout's .githooks, so git runs the main checkout's copy of the hook. The
 * stub secret scan records which checkout's copy the hook called, which shows
 * the root the hook settled on.
 */
function commitFromWorktree(hook: string) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tp-hook-root-')))
  temps.push(base)
  const main = join(base, 'main')
  const wt = join(base, 'wt')
  const marker = join(base, 'scan-calls')
  mkdirSync(join(main, '.githooks'), { recursive: true })
  mkdirSync(join(main, 'scripts'), { recursive: true })
  copyFileSync(hook, join(main, '.githooks/pre-commit'))
  chmodSync(join(main, '.githooks/pre-commit'), 0o755)
  writeFileSync(
    join(main, 'scripts/scan-secrets.sh'),
    '#!/bin/sh\nprintf \'%s\\n\' "$0" >> "$TP_HOOK_MARKER"\n'
  )
  chmodSync(join(main, 'scripts/scan-secrets.sh'), 0o755)
  writeFileSync(join(main, 'notes.txt'), 'first\n')

  git(main, ['init', '-q', '-b', 'trunk'])
  git(main, ['add', '-A'])
  git(main, ['commit', '-q', '-m', 'seed'])
  git(main, ['worktree', 'add', '-q', '-b', 'side', wt])
  git(main, ['config', 'core.hooksPath', join(main, '.githooks')])

  writeFileSync(join(wt, 'notes.txt'), 'edited in the worktree\n')
  git(wt, ['add', 'notes.txt'])
  git(wt, ['commit', '-q', '-m', 'edit'], {
    ...GIT_ENV,
    TP_HOOK_MARKER: marker,
    // The scan is what this test watches; the formatter and guards that
    // follow it need toolchains a throwaway repo does not have.
    TURBOPANEL_SKIP_HOOK_TESTS: '1',
    TURBOPANEL_SKIP_HOOK_FORMAT: '1',
  })

  return {
    scanned: readFileSync(marker, 'utf8').trim(),
    expectedScan: join(wt, 'scripts/scan-secrets.sh'),
    committed: git(wt, ['show', 'HEAD:notes.txt']),
  }
}

const HOOKS: { name: string; dir: string | null }[] = [
  { name: 'dev', dir: DEV_ROOT },
  ...SIBLINGS.map((name) => ({ name, dir: siblingCheckout(name) })),
]

// Every repo's pre-commit takes its root from git. Taken from the hook file's
// own path instead, a commit from a worktree with an absolute core.hooksPath
// ran the main checkout's scan and staged the main checkout's files, so the
// worktree's edits fell out of the commit.
describe('pre-commit finds the root of the tree being committed', () => {
  for (const { name, dir } of HOOKS) {
    it.skipIf(dir === null)(`${name}: from a worktree with an absolute core.hooksPath`, () => {
      const res = commitFromWorktree(join(dir!, '.githooks/pre-commit'))
      expect(res.scanned).toBe(res.expectedScan)
      expect(res.committed).toBe('edited in the worktree\n')
    })
  }
})

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = join(REPO_ROOT, 'scripts/vm-bootstrap.sh')
const SOURCE = readFileSync(SCRIPT, 'utf8')

describe('vm-bootstrap.sh', () => {
  test('is an executable POSIX sh script that parses', () => {
    expect(SOURCE.startsWith('#!/bin/sh\n')).toBe(true)
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0)
    expect(() => execFileSync('sh', ['-n', SCRIPT])).not.toThrow()
  })

  test('sets up the dev user the way ./console expects', () => {
    expect(SOURCE).toContain('usermod -aG sudo')
    expect(SOURCE).toContain('/etc/sudoers.d/turbopanel-dev-nopasswd')
    expect(SOURCE).toContain('NOPASSWD: ALL')
    expect(SOURCE).toContain('visudo -c')
    expect(SOURCE).toContain('export TURBOPANEL_MODE=')
  })

  test('takes the user name from the caller and never hard-codes one', () => {
    expect(SOURCE).toContain('SUDO_USER')
    expect(SOURCE).not.toMatch(/\bvagrant\b/)
    expect(SOURCE).not.toContain('/home/')
  })

  test('leaves out the Vagrant-only steps', () => {
    for (const forbidden of [
      'mount --bind',
      'tp-bind-node-modules',
      'turbopanel-virtfs-node-modules',
      'storeDir',
      'store-dir',
      'motd',
      'OPENSSL_armcap',
      'ssh_forward_supervisor',
    ]) {
      expect(SOURCE).not.toContain(forbidden)
    }
  })

  test('rejects an unknown option', () => {
    const run = () => execFileSync('sh', [SCRIPT, '--bogus'], { stdio: 'pipe' })
    expect(run).toThrow()
  })
})

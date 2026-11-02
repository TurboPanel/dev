import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

  test('writes one sudoers file per user', () => {
    expect(SOURCE).toContain('turbopanel-dev-nopasswd-uid${DEV_UID}')
  })

  test('rejects a bad alias name', () => {
    expect(() =>
      execFileSync('sh', [SCRIPT, '--lan-alias', 'bad name'], { stdio: 'pipe' })
    ).toThrow(/bad --lan-alias name/)
  })

  test('rejects a user name that is not plain', () => {
    expect(() => execFileSync('sh', [SCRIPT, '1000'], { stdio: 'pipe' })).toThrow(
      /not a plain user name/
    )
    expect(() => execFileSync('sh', [SCRIPT, 'a b'], { stdio: 'pipe' })).toThrow(
      /not a plain user name/
    )
  })

  test.each(['--swap', '.hidden', '-x'])('rejects the alias %s', (alias) => {
    expect(() => execFileSync('sh', [SCRIPT, '--lan-alias', alias], { stdio: 'pipe' })).toThrow(
      /bad --lan-alias name/
    )
  })

  test('uses an apt lock timeout', () => {
    expect(SOURCE).toContain('DPkg::Lock::Timeout=300')
  })

  test('checks the whole sudoers tree before any package, group or file change', () => {
    const check = SOURCE.indexOf('visudo -c 2>&1')
    expect(check).toBeGreaterThan(0)
    expect(check).toBeLessThan(SOURCE.indexOf('install -y sudo curl'))
    expect(check).toBeLessThan(SOURCE.indexOf('usermod -aG'))
    expect(check).toBeLessThan(SOURCE.indexOf('install -m 0440'))
  })

  test('stops with nothing changed when the sudoers tree is already invalid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vmb-'))
    const marker = join(dir, 'changed')
    const stub = (name: string, body: string) => {
      writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`)
      chmodSync(join(dir, name), 0o755)
    }
    stub('id', 'case "$1" in -u) echo 0 ;; *) echo sudo ;; esac')
    stub('getent', 'echo "pat:x:1001:1001::/home/pat:/bin/sh"')
    stub('visudo', 'echo broken >&2; exit 1')
    for (const cmd of ['apt-get', 'usermod', 'install', 'cp', 'mktemp']) {
      stub(cmd, `echo ${cmd} >> "${marker}"`)
    }
    let stderr = ''
    let status = 0
    try {
      execFileSync('sh', [SCRIPT, 'pat'], { env: { PATH: `${dir}:/usr/bin:/bin` }, stdio: 'pipe' })
    } catch (error) {
      const failure = error as { status: number; stderr: Buffer }
      status = failure.status
      stderr = failure.stderr.toString()
    }
    expect(status).toBe(1)
    expect(stderr).toContain('already invalid')
    expect(existsSync(marker)).toBe(false)
  })

  test('rejects an option that needs a value', () => {
    expect(() => execFileSync('sh', [SCRIPT, '--lan-alias'], { stdio: 'pipe' })).toThrow(/Usage/)
  })

  test('prints help on stdout', () => {
    expect(execFileSync('sh', [SCRIPT, '--help'], { encoding: 'utf8' })).toContain('Usage:')
  })

  test('rejects an unknown option', () => {
    const run = () => execFileSync('sh', [SCRIPT, '--bogus'], { stdio: 'pipe' })
    expect(run).toThrow()
  })
})

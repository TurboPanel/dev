import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = join(REPO_ROOT, 'scripts/vm-bootstrap.sh')
const SOURCE = readFileSync(SCRIPT, 'utf8')

/**
 * Run the script as user pat with stubbed system commands. Every command that
 * would change the machine only records its name, so `changed` says whether
 * the run got that far. `overrides` replaces a stub body.
 */
function runStubbed(
  overrides: Record<string, string>,
  env: Record<string, string> = {}
): { status: number; stderr: string; changed: boolean } {
  const dir = mkdtempSync(join(tmpdir(), 'vmb-'))
  const marker = join(dir, 'changed')
  const stubs: Record<string, string> = {
    id: 'case "$1" in -u) echo 0 ;; *) echo sudo ;; esac',
    getent: 'echo "pat:x:1001:1001::/srv/pat:/bin/sh"',
  }
  for (const cmd of ['visudo', 'apt-get', 'usermod', 'install', 'cp', 'mktemp', 'runuser']) {
    stubs[cmd] = `echo ${cmd} >> "${marker}"`
  }
  for (const [name, body] of Object.entries({ ...stubs, ...overrides })) {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`)
    chmodSync(join(dir, name), 0o755)
  }
  let stderr = ''
  let status = 0
  try {
    execFileSync('sh', [SCRIPT, 'pat'], {
      env: { PATH: `${dir}:/usr/bin:/bin`, ...env },
      stdio: 'pipe',
    })
  } catch (error) {
    const failure = error as { status: number; stderr: Buffer }
    status = failure.status
    stderr = failure.stderr.toString()
  }
  return { status, stderr, changed: existsSync(marker) }
}

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
    const { status, stderr, changed } = runStubbed({ visudo: 'echo broken >&2; exit 1' })
    expect(status).toBe(1)
    expect(stderr).toContain('already invalid')
    expect(changed).toBe(false)
  })

  test('clones into TURBOPANEL_DEV_ROOT and prints the console path there', () => {
    // Default ~/turbopanel/<repo>, never the bare home folder.
    expect(SOURCE).toContain('DEV_ROOT=${TURBOPANEL_DEV_ROOT:-$DEV_HOME/turbopanel}')
    expect(SOURCE).toContain('"${DEV_ROOT}/${repo}"')
    expect(SOURCE).toContain('${DEV_ROOT}/dev/console')
    expect(SOURCE).toContain('export TURBOPANEL_DEV_ROOT=')
    // git still runs with the real home, where the SSH keys are.
    expect(SOURCE).toContain('"HOME=${DEV_HOME}"')
  })

  test.each(['relative/turbopanel', '/srv/my repos', '/srv/a$b', '/srv/../root', '/'])(
    'rejects TURBOPANEL_DEV_ROOT=%s before changing anything',
    (root) => {
      const { status, stderr, changed } = runStubbed({}, { TURBOPANEL_DEV_ROOT: root })
      expect(status).toBe(1)
      expect(stderr).toContain('TURBOPANEL_DEV_ROOT=')
      expect(changed).toBe(false)
    }
  )

  test.each(['/srv/pat', '/srv/pat/work', '/srv/pat/turbopanel-old'])(
    'refuses TURBOPANEL_DEV_ROOT=%s: the folder must be named turbopanel',
    (root) => {
      const { status, stderr, changed } = runStubbed({}, { TURBOPANEL_DEV_ROOT: root })
      expect(status).toBe(1)
      expect(stderr).toContain('is not a folder named turbopanel')
      expect(stderr).toContain('run dev/scripts/setup.sh')
      expect(changed).toBe(false)
    }
  )

  test('stops with the move steps when the repos still sit in the home folder', () => {
    const home = mkdtempSync(join(tmpdir(), 'vmb-home-'))
    mkdirSync(join(home, 'dev'))
    writeFileSync(join(home, 'dev', 'Vagrantfile'), '# dev checkout\n')
    mkdirSync(join(home, 'turbopaneld'))
    const { status, stderr, changed } = runStubbed({
      getent: `echo "pat:x:1001:1001::${home}:/bin/sh"`,
    })
    expect(status).toBe(1)
    expect(stderr).toContain('which is not a folder named turbopanel')
    expect(stderr).toContain('mv tp-move turbopanel')
    expect(stderr).toContain('systemctl stop turbopaneld')
    expect(stderr).toContain(`${home}/turbopanel/dev/scripts/setup.sh`)
    expect(changed).toBe(false)
  })

  test('refuses a folder named turbopanel that is itself a git checkout', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'vmb-root-')), 'turbopanel')
    mkdirSync(join(root, '.git'), { recursive: true })
    const { status, stderr, changed } = runStubbed({}, { TURBOPANEL_DEV_ROOT: root })
    expect(status).toBe(1)
    expect(stderr).toContain('is a git checkout, not the folder that holds the repos')
    expect(changed).toBe(false)
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

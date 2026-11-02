import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = join(REPO_ROOT, 'scripts/start.sh')
const SOURCE = readFileSync(SCRIPT, 'utf8')
const DEV_URL = 'https://github.com/TurboPanel/dev.git'

// A fake git: logs every call; "clone" copies a template dev checkout to the
// last argument instead of talking to GitHub, everything else is real git.
const FAKE_GIT = `#!/bin/sh
echo "git $*" >> "$FAKE_LOG"
if [ "$1" = clone ]; then
  [ -z "$FAKE_CLONE_FAILS" ] || exit 128
  for last; do :; done
  cp -R "$FAKE_TEMPLATE" "$last"
  exit 0
fi
exec "$REAL_GIT" "$@"
`

// Stands in for setup.sh: prints what it was given.
const FAKE_SETUP = `#!/bin/sh
echo "setup.sh got: $*"
`

type Env = Record<string, string>

let root: string
let bin: string
let home: string
let template: string
const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()

function stub(name: string, body: string) {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`)
  chmodSync(join(bin, name), 0o755)
}

function baseEnv(extra: Env = {}): Env {
  return {
    PATH: `${bin}:/usr/local/bin:/usr/bin:/bin`,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    FAKE_LOG: join(root, 'git.log'),
    FAKE_TEMPLATE: template,
    FAKE_CLONE_FAILS: '',
    REAL_GIT: realGit,
    ...extra,
  }
}

function run(args: string[], extra: Env = {}, input?: string) {
  const result = spawnSync('/bin/sh', [SCRIPT, ...args], {
    cwd: home,
    encoding: 'utf8',
    env: baseEnv(extra),
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

const gitLog = () =>
  existsSync(join(root, 'git.log')) ? readFileSync(join(root, 'git.log'), 'utf8') : ''

// A real dev checkout with a TurboPanel/dev remote (no network: get-url only
// reads the config).
function devCheckout(folder: string, url = DEV_URL) {
  const dev = join(folder, 'dev')
  cpSync(template, dev, { recursive: true })
  execFileSync('git', ['init', '--quiet', '-b', 'trunk', dev], { env: baseEnv() })
  execFileSync('git', ['-C', dev, 'remote', 'add', 'origin', url], { env: baseEnv() })
  return dev
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tp-start-'))
  bin = join(root, 'bin')
  home = join(root, 'home')
  template = join(root, 'template')
  for (const dir of [bin, home, join(template, 'scripts')]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(template, 'scripts', 'setup.sh'), FAKE_SETUP)
  writeFileSync(join(bin, 'git'), FAKE_GIT)
  chmodSync(join(bin, 'git'), 0o755)
  stub('curl', 'exit 0')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('start.sh source', () => {
  test('is an executable POSIX sh script that runs only from its last line', () => {
    expect(SOURCE.startsWith('#!/bin/sh\n')).toBe(true)
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0)
    expect(() => execFileSync('sh', ['-n', SCRIPT])).not.toThrow()
    expect(SOURCE.trimEnd().split('\n').at(-1)).toBe('tp_start_main "$@"')
    expect(SOURCE).not.toMatch(/^\s*sudo\b/m)
  })

  test('prints help without cloning', () => {
    const { status, out } = run(['--help'])
    expect(status).toBe(0)
    expect(out).toContain('Usage: start.sh')
    expect(out).toContain('sh -s --')
    expect(gitLog()).toBe('')
  })
})

describe('start.sh checks', () => {
  test('refuses to run as root', () => {
    stub('id', '[ "$1" = -u ] && echo 0')
    const { status, out } = run([])
    expect(status).toBe(1)
    expect(out).toContain('not root')
    expect(gitLog()).toBe('')
  })

  test('stops with an install hint when git is missing', () => {
    rmSync(join(bin, 'git'))
    stub('id', 'echo 1000')
    const { status, out } = run([], { PATH: bin })
    expect(status).toBe(1)
    expect(out).toContain('sudo apt-get install git')
  })

  test('stops when neither curl nor wget is there', () => {
    rmSync(join(bin, 'curl'))
    stub('id', 'echo 1000')
    const { status, out } = run([], { PATH: bin })
    expect(status).toBe(1)
    expect(out).toContain('curl or wget is required')
  })

  test.each([
    ['/tmp/work', 'named turbopanel'],
    ['relative/turbopanel', 'absolute path'],
    ['/tmp/../tmp/turbopanel', '. or ..'],
    ['/tmp/my repos/turbopanel', 'only contain'],
    ['/', 'filesystem root'],
  ])('refuses the folder %s', (dir, message) => {
    const { status, out } = run(['--dir', dir])
    expect(status).toBe(1)
    expect(out).toContain(message)
    expect(gitLog()).not.toContain('clone')
  })

  test('refuses a folder that is itself a git checkout', () => {
    const folder = join(root, 'turbopanel')
    execFileSync('git', ['init', '--quiet', folder], { env: baseEnv() })
    const { status, out } = run(['--dir', folder])
    expect(status).toBe(1)
    expect(out).toContain('is a git checkout')
    expect(gitLog()).not.toContain('clone')
  })

  test('refuses a dev folder that is not a TurboPanel/dev checkout', () => {
    const folder = join(home, 'turbopanel')
    devCheckout(folder, 'https://github.com/someone/else.git')
    const { status, out } = run([])
    expect(status).toBe(1)
    expect(out).toContain('not a git checkout of TurboPanel/dev')
  })
})

describe('start.sh hand-off', () => {
  test('a fresh machine clones dev into ~/turbopanel and passes every option on', () => {
    const folder = join(home, 'turbopanel')
    const { status, out } = run(['--mode', 'direct', '--yes', '--fork'])
    expect(status, out).toBe(0)
    expect(gitLog()).toContain(`git clone --quiet ${DEV_URL} ${folder}/.start-clone-dev`)
    expect(existsSync(join(folder, 'dev', 'scripts', 'setup.sh'))).toBe(true)
    expect(existsSync(join(folder, '.start-clone-dev'))).toBe(false)
    expect(out).toContain(`clone ${DEV_URL} into ${folder}/dev`)
    expect(out).toContain('Vagrant: the repos stay in')
    expect(out).toContain('Direct:  this Debian 13 machine')
    expect(out).toContain(`setup.sh got: --mode direct --yes --fork --dir ${folder}`)
  })

  test('a failed clone leaves no half folder', () => {
    const folder = join(home, 'turbopanel')
    const { status, out } = run([], { FAKE_CLONE_FAILS: '1' })
    expect(status).toBe(1)
    expect(out).toContain('could not clone')
    expect(existsSync(join(folder, 'dev'))).toBe(false)
    expect(existsSync(join(folder, '.start-clone-dev'))).toBe(false)
  })

  test('an existing dev checkout is reused, not cloned again', () => {
    const folder = join(root, 'work', 'turbopanel')
    devCheckout(folder)
    const { status, out } = run(['status', '--dir', `${folder}/`])
    expect(status, out).toBe(0)
    expect(gitLog()).not.toContain('clone')
    expect(out).toContain('is already here')
    expect(out).toContain(`setup.sh got: status --dir ${folder}`)
  })

  test('a fork checkout (TurboPanel/dev as upstream, over ssh) counts as dev', () => {
    const folder = join(home, 'turbopanel')
    const dev = devCheckout(folder, 'https://github.com/octo/dev.git')
    execFileSync(
      'git',
      ['-C', dev, 'remote', 'add', 'upstream', 'git@github.com:turbopanel/DEV.git'],
      {
        env: baseEnv(),
      }
    )
    const { status, out } = run(['doctor'])
    expect(status, out).toBe(0)
    expect(out).toContain(`setup.sh got: doctor --dir ${folder}`)
  })

  test('--dry-run on a fresh machine prints the plan and clones nothing', () => {
    const folder = join(home, 'turbopanel')
    const { status, out } = run(['--dry-run', '--mode', 'vagrant'])
    expect(status, out).toBe(0)
    expect(gitLog()).toBe('')
    expect(existsSync(folder)).toBe(false)
    expect(out).toContain(`clone ${DEV_URL} into ${folder}/dev`)
    expect(out).toContain(`--mode vagrant --dry-run --dir ${folder}`)
    expect(out).toContain('nothing cloned')
    expect(out).not.toContain('setup.sh got')
  })

  test('--dry-run with dev in place runs the setup dry run', () => {
    const folder = join(home, 'turbopanel')
    devCheckout(folder)
    const { status, out } = run(['--dry-run'])
    expect(status, out).toBe(0)
    expect(out).toContain(`setup.sh got: --dry-run --dir ${folder}`)
  })

  test('piped in without a terminal, the script text never reaches setup.sh', () => {
    const folder = join(home, 'turbopanel')
    devCheckout(folder)
    const result = spawnSync('/bin/sh', ['-s', '--', '--mode', 'vagrant'], {
      cwd: home,
      encoding: 'utf8',
      env: baseEnv(),
      input: SOURCE,
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(`setup.sh got: --mode vagrant --dir ${folder}`)
  })
})

// util-linux script(1) runs the pipeline on a real pseudo-terminal, so setup.sh
// sees a controlling terminal while the starter itself is read from a pipe.
const hasUtilLinuxScript =
  spawnSync('script', ['--version'], { encoding: 'utf8' }).stdout?.includes('util-linux') ?? false

describe.skipIf(!hasUtilLinuxScript)('start.sh with curl | sh on a terminal', () => {
  test('the real setup.sh asks how to run TurboPanel once, on the terminal', () => {
    const folder = join(home, 'turbopanel')
    const dev = devCheckout(folder)
    mkdirSync(join(dev, 'scripts', 'lib'), { recursive: true })
    cpSync(join(REPO_ROOT, 'scripts', 'setup.sh'), join(dev, 'scripts', 'setup.sh'))
    cpSync(
      join(REPO_ROOT, 'scripts', 'lib', 'privileges.sh'),
      join(dev, 'scripts', 'lib', 'privileges.sh')
    )
    cpSync(join(REPO_ROOT, 'repos.list'), join(dev, 'repos.list'))
    const osRelease = join(root, 'os-release')
    writeFileSync(osRelease, 'PRETTY_NAME="Debian 13"\nID=debian\nVERSION_ID="13"\n')
    stub('uname', 'case "$1" in -m) echo x86_64 ;; *) echo Linux ;; esac')
    stub('systemd-detect-virt', 'if [ "$1" = --container ]; then echo none; exit 1; fi; echo kvm')
    stub(
      'gh',
      'case "$1 $2" in "auth token") exit 0 ;; "api user") echo octo ;; "config get") echo https ;; "api repos/TurboPanel/"*) echo true ;; esac; exit 0'
    )
    stub('vagrant', 'echo vagrant-libvirt')
    const result = spawnSync(
      'script',
      ['-qec', 'cat "$START" | sh -s -- --dir "$FOLDER"', '/dev/null'],
      {
        cwd: home,
        encoding: 'utf8',
        env: baseEnv({
          SHELL: '/bin/sh',
          START: SCRIPT,
          FOLDER: folder,
          TURBOPANEL_SETUP_OS_RELEASE: osRelease,
        }),
        input: '1\nn\n',
        timeout: 30_000,
      }
    )
    const out = `${result.stdout}${result.stderr}`
    expect(out.split('How do you want to run TurboPanel?').length - 1, out).toBe(1)
    expect(out).toContain('1) Vagrant: the repos stay in')
    expect(out).toContain(`Folder:       ${folder}`)
    expect(out).toContain('Mode:         vagrant')
    expect(out).toContain('Stopped; nothing changed.')
    expect(gitLog()).not.toContain('clone')
  })
})

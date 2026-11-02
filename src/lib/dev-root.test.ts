import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { buildDaemonBaseEnvEntries } from './daemon-env.ts'
import {
  devHomeEnvEntry,
  DevRootError,
  devRootSyntaxError,
  resolveCheckedDevRoot,
  resolveDevHome,
} from './dev-root.ts'
import { platformRepoPath, resolveDevRoot } from './paths.ts'

const PATHS_SH = join(dirname(fileURLToPath(import.meta.url)), '../../scripts/lib/paths.sh')
const ON_LINUX = process.platform === 'linux'

let scratch = ''

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tp-dev-root-'))
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

function shellEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: scratch, ...extra }
}

function runShell(value: string): { status: number | null; stderr: string } {
  const result = spawnSync(
    'sh',
    ['-c', '. "$1"; tp_validate_dev_root "$2"', 'sh', PATHS_SH, value],
    {
      encoding: 'utf8',
      env: shellEnv(),
    }
  )
  return { status: result.status, stderr: result.stderr }
}

describe('resolveDevRoot', () => {
  test("defaults to the dev user's home when TURBOPANEL_DEV_ROOT is unset", () => {
    vi.stubEnv('TURBOPANEL_DEV_ROOT', '')
    vi.stubEnv('TURBOPANEL_INSTANCE_REPO', '')
    vi.stubEnv('HOME', '/home/pat')
    expect(resolveDevRoot()).toBe('/home/pat')
    expect(platformRepoPath('turbopanel')).toBe('/home/pat/turbopanel')
  })

  test('puts every repo under a folder outside the home when set', () => {
    vi.stubEnv('TURBOPANEL_DEV_ROOT', '/home/pat/work/turbopanel')
    vi.stubEnv('HOME', '/home/pat')
    vi.stubEnv('TURBOPANEL_INSTANCE_REPO', '')
    vi.stubEnv('TURBOPANEL_DAEMON_REPO', '')
    expect(resolveDevRoot()).toBe('/home/pat/work/turbopanel')
    expect(platformRepoPath('turbopanel')).toBe('/home/pat/work/turbopanel/turbopanel')
    expect(platformRepoPath('turbopaneld')).toBe('/home/pat/work/turbopanel/turbopaneld')
  })
})

describe('devRootSyntaxError', () => {
  test.each([
    ['relative/turbopanel', 'absolute'],
    ['~/work/turbopanel', 'absolute'],
    ['/', 'filesystem root'],
    ['/home/pat/my repos/turbopanel', 'no spaces'],
    ['/home/pat/$HOME/turbopanel', 'no spaces'],
    ['/home/pat/a;b', 'no spaces'],
    ['/home/pat/a:b', 'no spaces'],
    ['/home/pat/a#b', 'no spaces'],
    ["/home/pat/'q'", 'no spaces'],
    ['/home/pat/../root', '. or ..'],
    ['/home/pat/./turbopanel', '. or ..'],
  ])('rejects %s', (value, fragment) => {
    expect(devRootSyntaxError(value)).toContain(fragment)
  })

  test.each(['/home/pat', '/home/pat/work/turbopanel', '/srv/dev-1/turbo_panel.v2'])(
    'accepts %s',
    (value) => {
      expect(devRootSyntaxError(value)).toBeNull()
    }
  )
})

describe('resolveCheckedDevRoot', () => {
  test('returns the root when it is usable', () => {
    vi.stubEnv('TURBOPANEL_DEV_ROOT', '/home/pat/work/turbopanel')
    expect(resolveCheckedDevRoot()).toBe('/home/pat/work/turbopanel')
  })

  test('names the variable and the problem for a bad value', () => {
    vi.stubEnv('TURBOPANEL_DEV_ROOT', '/home/pat/my repos')
    expect(() => resolveCheckedDevRoot()).toThrow(DevRootError)
    expect(() => resolveCheckedDevRoot()).toThrow(
      'TURBOPANEL_DEV_ROOT=/home/pat/my repos may only contain'
    )
  })
})

describe('resolveDevHome and daemon.env', () => {
  test.skipIf(!ON_LINUX)("reads the dev user's home from passwd", () => {
    const me = userInfo()
    expect(resolveDevHome(me.username)).toBe(me.homedir)
    expect(resolveDevHome('tp-no-such-user-xyz')).toBeNull()
  })

  test.skipIf(!ON_LINUX)('daemon.env keeps the repo folder and the real home apart', () => {
    vi.stubEnv('TURBOPANEL_DEV_ROOT', '/home/pat/work/turbopanel')
    const entries = buildDaemonBaseEnvEntries()
    expect(entries.TURBOPANEL_DEV_ROOT).toBe('/home/pat/work/turbopanel')
    expect(entries.TURBOPANEL_DEV_HOME).toBe(userInfo().homedir)
  })

  test('daemon.env refuses a root that would break the files it is written into', () => {
    vi.stubEnv('TURBOPANEL_DEV_ROOT', 'work/turbopanel')
    expect(() => buildDaemonBaseEnvEntries()).toThrow(DevRootError)
  })
})

describe('tp_validate_dev_root (scripts/lib/paths.sh)', () => {
  test('accepts an existing folder and one it can create', () => {
    expect(runShell(scratch).status).toBe(0)
    expect(runShell(`${join(scratch, 'work', 'turbopanel')}/`).status).toBe(0)
  })

  test('drops trailing slashes from TURBOPANEL_DEV_ROOT when it checks the env', () => {
    const result = spawnSync(
      'sh',
      ['-c', '. "$1"; tp_validate_dev_root && printf %s "$TURBOPANEL_DEV_ROOT"', 'sh', PATHS_SH],
      { encoding: 'utf8', env: shellEnv({ TURBOPANEL_DEV_ROOT: `${scratch}//` }) }
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(scratch)
  })

  test.each([
    ['work/turbopanel', 'must be an absolute path'],
    ['/', 'must not be the filesystem root'],
    ['/home/pat/my repos', 'no spaces'],
    ['/home/pat/a$b', 'no spaces'],
    ['/home/pat/../root', '. or ..'],
  ])('rejects %s the same way as the console', (value, fragment) => {
    const { status, stderr } = runShell(value)
    expect(status).toBe(1)
    expect(stderr).toContain(fragment)
    expect(devRootSyntaxError(value)).toContain(fragment)
  })

  test.skipIf(process.getuid?.() === 0)(
    'rejects a folder the user cannot read or create in',
    () => {
      const locked = join(scratch, 'locked')
      mkdirSync(locked)
      chmodSync(locked, 0o000)
      try {
        expect(runShell(locked).stderr).toContain('not readable')
        expect(runShell(join(locked, 'turbopanel')).stderr).toContain('cannot be created')
      } finally {
        chmodSync(locked, 0o755)
      }
    }
  )

  test('rejects a path under a file', () => {
    const file = join(scratch, 'file')
    writeFileSync(file, 'x')
    const { status, stderr } = runShell(join(file, 'turbopanel'))
    expect(status).toBe(1)
    expect(stderr).toContain('cannot be created')
  })
})

describe('tp_load_dev_root_mode_file (scripts/lib/paths.sh)', () => {
  // <scratch>/turbopanel/{dev,.turbopanel-dev-mode}, as setup.sh lays it out.
  function layout(modeLines: string[] | null): { root: string; dev: string } {
    const root = join(scratch, 'turbopanel')
    const dev = join(root, 'dev')
    mkdirSync(dev, { recursive: true })
    if (modeLines) writeFileSync(join(root, '.turbopanel-dev-mode'), `${modeLines.join('\n')}\n`)
    return { root, dev }
  }

  function load(dev: string, env: Record<string, string> = {}) {
    const result = spawnSync(
      'sh',
      [
        '-c',
        '. "$1"; tp_load_dev_root_mode_file "$2" && printf %s "$TURBOPANEL_DEV_ROOT"',
        'sh',
        PATHS_SH,
        dev,
      ],
      { encoding: 'utf8', env: shellEnv(env) }
    )
    return { status: result.status, root: result.stdout, stderr: result.stderr }
  }

  test('takes dev_root from the mode file next to the repos', () => {
    const { root, dev } = layout([
      '# written by setup.sh',
      "TURBOPANEL_DEV_ENV='direct'",
      `dev_root='${'$'}{HOME}/ignored'`,
      `dev_root='${scratch}/turbopanel'`,
    ])
    expect(load(dev)).toEqual({ status: 0, root, stderr: '' })
  })

  test('an explicit TURBOPANEL_DEV_ROOT wins over the mode file', () => {
    const { dev, root } = layout([`dev_root='${scratch}/turbopanel'`])
    expect(load(dev, { TURBOPANEL_DEV_ROOT: '/srv/elsewhere' }).root).toBe('/srv/elsewhere')
    expect(root).not.toBe('/srv/elsewhere')
  })

  test('falls back to the home folder without a mode file', () => {
    const { dev } = layout(null)
    expect(load(dev).root).toBe(scratch)
  })

  test('never runs the file: a command line in it is ignored', () => {
    const marker = join(scratch, 'ran')
    const { dev } = layout([`touch ${marker}`, `dev_root='${scratch}/turbopanel'`])
    load(dev)
    expect(() => readFileSync(marker)).toThrow()
  })

  test('undoes the quote escape setup.sh writes, and the validator then refuses the value', () => {
    const { dev, root } = layout(["dev_root='/srv/it'\\''s'"])
    const result = load(dev)
    // The unescaped value names another folder, so the folder holding the file wins.
    expect(result.stderr).toContain("says dev_root=/srv/it's")
    expect(result.root).toBe(root)
    expect(devRootSyntaxError("/srv/it's")).toContain('no spaces')
  })

  test('a moved folder: the folder that holds the mode file wins, with a warning', () => {
    const { dev, root } = layout(["dev_root='/srv/old/turbopanel'"])
    const result = load(dev)
    expect(result.root).toBe(root)
    expect(result.stderr).toContain('rerun dev/scripts/setup.sh')
  })
})

describe('devHomeEnvEntry', () => {
  test('warns loudly and leaves the key out when the home cannot be read', () => {
    const warn = vi.fn()
    expect(devHomeEnvEntry('tp-no-such-user-xyz', '/srv/turbopanel', warn)).toEqual({})
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('WARNING'))
    expect(warn.mock.calls[0]?.[0]).toContain('/srv/turbopanel as HOME')
  })

  test.skipIf(!ON_LINUX)('writes the home when passwd has a usable one', () => {
    const warn = vi.fn()
    expect(devHomeEnvEntry(userInfo().username, '/srv/turbopanel', warn)).toEqual({
      TURBOPANEL_DEV_HOME: userInfo().homedir,
    })
    expect(warn).not.toHaveBeenCalled()
  })
})

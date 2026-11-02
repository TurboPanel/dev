import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
const SCRIPT = join(REPO_ROOT, 'scripts/setup.sh')
const SOURCE = readFileSync(SCRIPT, 'utf8')
const REPOS = ['dev', 'turbopanel', 'turbopaneld', 'ui', 'website', '.github']

// A fake gh driven by environment variables. It never talks to GitHub: forks
// are bare clones inside the fixture folder, listed in forks.txt as
// "<repo> <owner>/<name>". FAKE_GH_API_DOWN makes every API call fail.
const FAKE_GH = `#!/bin/sh
echo "gh $*" >> "$FAKE_GH_LOG"
forks="$FAKE_FIXTURE/forks.txt"
case "$1 $2" in
  "auth token" | "auth status") [ -n "$FAKE_GH_LOGIN" ] || exit 1; exit 0 ;;
  "auth setup-git") exit 0 ;;
  "config get") echo "$FAKE_GH_PROTOCOL"; exit 0 ;;
  "repo fork")
    [ -z "$FAKE_GH_API_DOWN" ] || exit 1
    [ -z "$FAKE_GH_FORK_NOOP" ] || exit 0
    repo=\${3#TurboPanel/}
    git clone --quiet --bare "$FAKE_FIXTURE/TurboPanel/$repo.git" "$FAKE_FIXTURE/$FAKE_GH_LOGIN/$repo.git"
    echo "$repo $FAKE_GH_LOGIN/$repo" >> "$forks"
    exit 0 ;;
  "pr list") echo "$FAKE_GH_PR"; exit 0 ;;
  *) ;;
esac
if [ "$1" = api ]; then
  [ -z "$FAKE_GH_API_DOWN" ] || exit 1
  shift
  [ "$1" != --paginate ] || shift
  case "$1" in
    user) echo "$FAKE_GH_LOGIN"; exit 0 ;;
    repos/TurboPanel/*/forks*)
      repo=\${1#repos/TurboPanel/}
      repo=\${repo%%/forks*}
      [ ! -f "$forks" ] || awk -v r="$repo" -v o="$FAKE_GH_LOGIN/" '$1 == r && index($2, o) == 1 {print $2}' "$forks"
      exit 0 ;;
    repos/TurboPanel/*) echo "$FAKE_GH_PUSH"; exit 0 ;;
    repos/*)
      slug=\${1#repos/}
      [ -d "$FAKE_FIXTURE/$slug.git" ] || exit 1
      if [ -f "$forks" ] && awk -v s="$slug" '$2 == s {found=1} END {exit !found}' "$forks"; then
        echo "TurboPanel/\${slug#*/}"
      else
        echo ""
      fi
      exit 0 ;;
    *) ;;
  esac
fi
exit 0
`

type Env = Record<string, string>

let root: string
let fixture: string
let bin: string
let work: string
let home: string
let osRelease: string

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: baseEnv() }).trim()

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
    TURBOPANEL_SETUP_REMOTE_BASE: `file://${fixture}`,
    TURBOPANEL_SETUP_OS_RELEASE: osRelease,
    TURBOPANEL_SETUP_FORK_WAIT: '4',
    FAKE_FIXTURE: fixture,
    FAKE_GH_LOG: join(root, 'gh.log'),
    FAKE_GH_LOGIN: 'octo',
    FAKE_GH_PUSH: 'true',
    FAKE_GH_PROTOCOL: 'https',
    FAKE_GH_PR: '',
    FAKE_GH_API_DOWN: '',
    FAKE_UNAME_S: 'Linux',
    ...extra,
  }
}

function run(args: string[], extra: Env = {}, cwd?: string) {
  const result = spawnSync('sh', [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: baseEnv(extra),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

function setup(extra: Env = {}, more: string[] = []) {
  return run(['--dir', work, '--yes', '--mode', 'vagrant', ...more], extra)
}

function osIs(id: string, version: string) {
  writeFileSync(osRelease, `PRETTY_NAME="${id} ${version}"\nID=${id}\nVERSION_ID="${version}"\n`)
}

function upstreamCommit(repo: string, file: string) {
  const scratch = join(root, `scratch-${repo}-${file}`)
  execFileSync('git', ['clone', '--quiet', join(fixture, 'TurboPanel', `${repo}.git`), scratch], {
    env: baseEnv(),
  })
  writeFileSync(join(scratch, file), 'x\n')
  git(scratch, 'add', file)
  git(scratch, 'commit', '--quiet', '-m', `add ${file}`)
  git(scratch, 'push', '--quiet', 'origin', 'trunk')
  return git(scratch, 'rev-parse', 'HEAD')
}

const modeFile = () => readFileSync(join(work, '.turbopanel-dev-mode'), 'utf8')
const ghLog = () =>
  existsSync(join(root, 'gh.log')) ? readFileSync(join(root, 'gh.log'), 'utf8') : ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tp-setup-'))
  fixture = join(root, 'github')
  bin = join(root, 'bin')
  work = join(root, 'turbopanel')
  home = join(root, 'home')
  osRelease = join(root, 'os-release')
  for (const dir of [bin, home, join(fixture, 'TurboPanel'), join(fixture, 'octo')]) {
    mkdirSync(dir, { recursive: true })
  }
  osIs('debian', '13')
  writeFileSync(join(bin, 'gh'), FAKE_GH)
  chmodSync(join(bin, 'gh'), 0o755)
  stub('uname', 'case "$1" in -m) echo x86_64 ;; *) echo "$FAKE_UNAME_S" ;; esac')
  stub(
    'systemd-detect-virt',
    'if [ "$1" = --container ]; then echo "${FAKE_CONTAINER:-none}"; [ -n "$FAKE_CONTAINER" ]; exit; fi; echo "${FAKE_VIRT:-kvm}"'
  )
  stub('vagrant', 'echo vagrant_utm; echo vagrant-libvirt')
  stub('sudo', 'echo "sudo $*" >> "$FAKE_GH_LOG.sudo"; exit 0')
  for (const repo of REPOS) {
    const seed = join(root, `seed-${repo}`)
    execFileSync('git', ['init', '--quiet', '-b', 'trunk', seed], { env: baseEnv() })
    mkdirSync(join(seed, '.githooks'))
    writeFileSync(join(seed, '.githooks', 'pre-commit'), '#!/bin/sh\nexit 0\n')
    writeFileSync(join(seed, 'README.md'), `${repo}\n`)
    git(seed, 'add', '.')
    git(seed, 'commit', '--quiet', '-m', 'first')
    execFileSync(
      'git',
      ['clone', '--quiet', '--bare', seed, join(fixture, 'TurboPanel', `${repo}.git`)],
      { env: baseEnv() }
    )
  }
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('setup.sh source', () => {
  test('is an executable POSIX sh script that parses', () => {
    expect(SOURCE.startsWith('#!/bin/sh\n')).toBe(true)
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0)
    expect(() => execFileSync('sh', ['-n', SCRIPT])).not.toThrow()
  })

  test('never resets, stashes or force-switches a checkout', () => {
    for (const forbidden of ['reset --hard', 'checkout -f', 'clean -f', 'push --force']) {
      expect(SOURCE).not.toContain(forbidden)
    }
    expect(SOURCE).not.toMatch(/git\b[^\n]*\bstash\b/)
  })

  test('keeps TURBOPANEL_MODE for development versus production', () => {
    expect(SOURCE).not.toContain('TURBOPANEL_MODE')
    expect(SOURCE).toContain('TURBOPANEL_DEV_ENV')
  })

  test('reads the repo list from repos.list with all six repos', () => {
    const list = readFileSync(join(REPO_ROOT, 'repos.list'), 'utf8')
      .split('\n')
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split(/\s+/))
    expect(list.map(([name]) => name)).toEqual(REPOS)
    expect(list.every(([, branch]) => branch === 'trunk')).toBe(true)
  })

  test('prints help and rejects unknown input', () => {
    expect(run(['--help']).out).toContain('Usage: setup.sh')
    expect(run(['--bogus']).status).toBe(2)
    expect(run(['--mode', 'cloud']).out).toContain('unknown mode')
  })
})

describe('setup.sh roles', () => {
  test('push access: origin is the TurboPanel repo and there is no upstream', () => {
    const { status, out } = setup()
    expect(status, out).toBe(0)
    for (const repo of REPOS) {
      const path = join(work, repo)
      expect(git(path, 'remote', 'get-url', 'origin')).toBe(
        `file://${fixture}/TurboPanel/${repo}.git`
      )
      expect(git(path, 'remote')).toBe('origin')
      expect(git(path, 'config', 'core.hooksPath')).toBe('.githooks')
    }
    expect(ghLog()).toContain('gh auth setup-git')
    expect(ghLog()).not.toContain('repo fork')
    const mode = modeFile()
    expect(mode).toContain("TURBOPANEL_DEV_ENV='vagrant'")
    expect(mode).toContain(`dev_root='${work}'`)
    expect(mode).toContain("clone_protocol='https'")
    expect(mode).toContain("role_dev='maintainer'")
    expect(mode).toContain("role_github='maintainer'")
    expect(mode).toMatch(/^created='\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ'$/m)
    expect(out).toContain('vagrant up')
  })

  test('no push access: forks every repo but .github and adds upstream', () => {
    const { status, out } = setup({ FAKE_GH_PUSH: 'false' })
    expect(status, out).toBe(0)
    for (const repo of REPOS.filter((name) => name !== '.github')) {
      const path = join(work, repo)
      expect(git(path, 'remote', 'get-url', 'origin')).toBe(`file://${fixture}/octo/${repo}.git`)
      expect(git(path, 'remote', 'get-url', 'upstream')).toBe(
        `file://${fixture}/TurboPanel/${repo}.git`
      )
      expect(git(path, 'rev-parse', '--abbrev-ref', 'trunk@{upstream}')).toBe('upstream/trunk')
    }
    expect(ghLog()).not.toContain('repo fork TurboPanel/.github')
    expect(existsSync(join(fixture, 'octo', '.github.git'))).toBe(false)
    expect(git(join(work, '.github'), 'remote')).toBe('origin')
    expect(modeFile()).toContain("role_turbopanel='contributor'")
    expect(modeFile()).toContain("role_github='readonly'")
  })

  test('--fork makes a maintainer work like a contributor', () => {
    const { status, out } = setup({}, ['--fork'])
    expect(status, out).toBe(0)
    expect(git(join(work, 'ui'), 'remote', 'get-url', 'origin')).toContain('/octo/ui.git')
    expect(modeFile()).toContain("role_ui='contributor'")
  })

  test('a fork that exists already is reused', () => {
    execFileSync('git', [
      'clone',
      '--quiet',
      '--bare',
      join(fixture, 'TurboPanel', 'ui.git'),
      join(fixture, 'octo', 'ui.git'),
    ])
    writeFileSync(join(fixture, 'forks.txt'), 'ui octo/ui\n')
    expect(setup({ FAKE_GH_PUSH: 'false' }).status).toBe(0)
    expect(ghLog()).not.toContain('repo fork TurboPanel/ui')
  })

  test('a renamed fork is found through the fork list', () => {
    execFileSync('git', [
      'clone',
      '--quiet',
      '--bare',
      join(fixture, 'TurboPanel', 'ui.git'),
      join(fixture, 'octo', 'my-ui.git'),
    ])
    writeFileSync(join(fixture, 'forks.txt'), 'ui octo/my-ui\n')
    const { status, out } = setup({ FAKE_GH_PUSH: 'false' })
    expect(status, out).toBe(0)
    expect(git(join(work, 'ui'), 'remote', 'get-url', 'origin')).toBe(
      `file://${fixture}/octo/my-ui.git`
    )
    expect(ghLog()).not.toContain('repo fork TurboPanel/ui')
  })

  test('a fork that never appears fails that repo within the wait', () => {
    const started = Date.now()
    const { status, out } = setup({
      FAKE_GH_PUSH: 'false',
      FAKE_GH_FORK_NOOP: '1',
      TURBOPANEL_SETUP_FORK_WAIT: '0',
    })
    expect(status).toBe(1)
    expect(out).toContain('your fork of TurboPanel/ui was not ready within 0s')
    expect(existsSync(join(work, 'ui'))).toBe(false)
    expect(existsSync(join(work, '.github', '.git'))).toBe(true)
    expect(Date.now() - started).toBeLessThan(30_000)
  })

  test('an answer without permissions never forks', () => {
    const { status, out } = setup({ FAKE_GH_PUSH: 'null' })
    expect(status, out).toBe(0)
    expect(out).toContain('ui: GitHub did not say whether you can push; keeping readonly.')
    expect(ghLog()).not.toContain('repo fork')
    expect(modeFile()).toContain("role_ui='readonly'")
    setup()
    setup({ FAKE_GH_PUSH: 'null' })
    expect(modeFile()).toContain("role_ui='maintainer'")
  })

  test('logged out: read-only clones and a pointer to gh auth login', () => {
    const { status, out } = setup({ FAKE_GH_LOGIN: '' })
    expect(status, out).toBe(0)
    expect(out).toContain('gh auth login')
    expect(ghLog()).not.toContain('repo fork')
    expect(ghLog()).not.toContain('setup-git')
    expect(modeFile()).toContain("role_turbopaneld='readonly'")
  })

  test('ssh in the gh config is recorded as the clone protocol', () => {
    setup({ FAKE_GH_PROTOCOL: 'ssh' })
    expect(modeFile()).toContain("clone_protocol='ssh'")
    expect(ghLog()).not.toContain('setup-git')
  })
})

describe('setup.sh reruns', () => {
  test('a rerun keeps created, fast-forwards a clean trunk and skips a dirty one', () => {
    expect(setup().status).toBe(0)
    const created = /^created=.*$/m.exec(modeFile())?.[0]
    const uiNew = upstreamCommit('ui', 'new.txt')
    upstreamCommit('website', 'new.txt')
    writeFileSync(join(work, 'website', 'README.md'), 'local edit\n')
    const websiteHead = git(join(work, 'website'), 'rev-parse', 'HEAD')

    const { status, out } = setup()
    expect(status, out).toBe(0)
    expect(/^created=.*$/m.exec(modeFile())?.[0]).toBe(created)
    expect(git(join(work, 'ui'), 'rev-parse', 'HEAD')).toBe(uiNew)
    expect(git(join(work, 'website'), 'rev-parse', 'HEAD')).toBe(websiteHead)
    expect(readFileSync(join(work, 'website', 'README.md'), 'utf8')).toBe('local edit\n')
    expect(out).toContain('website: trunk has local changes; left as it is.')
    expect(out).toMatch(/website\s+maintainer\s+trunk\s+\+0 -1\s+1/)
  })

  test('a trunk that is not checked out is fast-forwarded without touching the tree', () => {
    setup()
    git(join(work, 'ui'), 'switch', '--quiet', '-c', 'feature')
    writeFileSync(join(work, 'ui', 'wip.txt'), 'wip\n')
    const next = upstreamCommit('ui', 'next.txt')
    expect(setup().status).toBe(0)
    expect(git(join(work, 'ui'), 'rev-parse', 'trunk')).toBe(next)
    expect(git(join(work, 'ui'), 'branch', '--show-current')).toBe('feature')
    expect(existsSync(join(work, 'ui', 'wip.txt'))).toBe(true)
  })

  test('logging in later turns read-only clones into fork checkouts', () => {
    setup({ FAKE_GH_LOGIN: '' })
    const { status, out } = setup({ FAKE_GH_PUSH: 'false' })
    expect(status, out).toBe(0)
    const ui = join(work, 'ui')
    expect(git(ui, 'remote', 'get-url', 'origin')).toContain('/octo/ui.git')
    expect(git(ui, 'remote', 'get-url', 'upstream')).toContain('/TurboPanel/ui.git')
    expect(modeFile()).toContain("role_ui='contributor'")
  })

  test('an offline rerun keeps the login and roles and makes no GitHub call', () => {
    setup({ FAKE_GH_PUSH: 'false' })
    rmSync(join(root, 'gh.log'))
    const { status, out } = setup({ FAKE_GH_API_DOWN: '1' })
    expect(status, out).toBe(0)
    expect(out).toContain('keeping the login and roles from the last run (octo)')
    expect(modeFile()).toContain("github_login='octo'")
    expect(modeFile()).toContain("role_ui='contributor'")
    expect(modeFile()).toContain("role_github='readonly'")
    expect(ghLog()).not.toContain('repo fork')
    expect(ghLog()).not.toContain('api repos/')
    expect(ghLog()).not.toContain('setup-git')
  })

  test('a trunk checked out in a linked worktree is never moved', () => {
    setup()
    const ui = join(work, 'ui')
    const linked = join(root, 'ui-linked')
    git(ui, 'switch', '--quiet', '-c', 'feature')
    git(ui, 'worktree', 'add', '--quiet', linked, 'trunk')
    const before = git(linked, 'rev-parse', 'HEAD')
    upstreamCommit('ui', 'later.txt')
    const { status, out } = setup()
    expect(status, out).toBe(0)
    expect(out).toContain('ui: trunk is checked out in another worktree; left as it is.')
    expect(git(linked, 'rev-parse', 'HEAD')).toBe(before)
    expect(git(ui, 'rev-parse', 'trunk')).toBe(before)
    expect(git(linked, 'status', '--porcelain')).toBe('')
  })

  test('a custom core.hooksPath is kept with a warning', () => {
    setup()
    git(join(work, 'ui'), 'config', 'core.hooksPath', 'myhooks')
    const { out } = setup()
    expect(out).toContain('ui: core.hooksPath is myhooks, not .githooks; left as it is')
    expect(git(join(work, 'ui'), 'config', 'core.hooksPath')).toBe('myhooks')
  })

  // setsid -w starts a new session with no controlling terminal, so no prompt can open.
  test.skipIf(spawnSync('setsid', ['-w', 'true']).status !== 0)(
    'a run without a terminal and without --yes stops with an error',
    () => {
      const result = spawnSync('setsid', ['-w', 'sh', SCRIPT, '--dir', work, '--mode', 'vagrant'], {
        encoding: 'utf8',
        env: baseEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      expect(result.status).toBe(1)
      expect(`${result.stdout}${result.stderr}`).toContain('Pass --yes to run without asking.')
      expect(existsSync(work)).toBe(false)
    }
  )

  test('a failed clone leaves no half folder and the others finish', () => {
    rmSync(join(fixture, 'TurboPanel', 'website.git'), { recursive: true })
    const { status, out } = setup()
    expect(status).toBe(1)
    expect(out).toContain('website: clone failed')
    expect(existsSync(join(work, 'website'))).toBe(false)
    expect(readdirSync(work).filter((name) => name.startsWith('.setup-clone'))).toEqual([])
    expect(existsSync(join(work, 'ui', '.git'))).toBe(true)
  })

  test('a folder that is not a checkout is left alone', () => {
    mkdirSync(join(work, 'ui'), { recursive: true })
    writeFileSync(join(work, 'ui', 'mine.txt'), 'keep\n')
    const { status, out } = setup()
    expect(status).toBe(1)
    expect(out).toContain('is not a git checkout; left alone')
    expect(readdirSync(join(work, 'ui'))).toEqual(['mine.txt'])
  })

  test('--dry-run prints the plan and writes nothing', () => {
    const { status, out } = run(['--dir', work, '--dry-run'])
    expect(status, out).toBe(0)
    expect(out).toContain('Plan (nothing has changed yet)')
    expect(out).toContain('Dry run: nothing changed.')
    expect(existsSync(work)).toBe(false)
    expect(ghLog()).not.toContain('setup-git')
  })
})

describe('setup.sh folder', () => {
  test('from inside a dev checkout the default folder sits next to it', () => {
    const { status, out } = run(['--dry-run'], {}, REPO_ROOT)
    expect(status, out).toBe(0)
    const folder = /Folder: +(.*)/.exec(out)?.[1] ?? ''
    expect(folder.startsWith(`${REPO_ROOT}/`)).toBe(false)
    expect(folder.endsWith('/turbopanel')).toBe(true)
  })

  test('a folder inside the dev checkout is refused', () => {
    const { status, out } = run(['--dry-run', '--dir', join(REPO_ROOT, 'turbopanel')])
    expect(status).toBe(1)
    expect(out).toContain('is inside the dev checkout')
  })

  test('--dir with .. is normalised', () => {
    mkdirSync(join(root, 'x'))
    expect(setup({}, ['--dir', join(root, 'x', '..', 'turbopanel')]).status).toBe(0)
    expect(modeFile()).toContain(`dev_root='${work}'`)
  })

  test('a folder with a quote in its name round-trips through the mode file', () => {
    const quoted = join(root, "it's here")
    const { status, out } = run(['--dir', quoted, '--yes', '--mode', 'vagrant'])
    expect(status, out).toBe(0)
    const doctor = run(['doctor', '--dir', quoted])
    expect(doctor.out).not.toContain('differs')
    expect(doctor.status, doctor.out).toBe(0)
  })

  test('the plan names the global git change', () => {
    const { out } = run(['--dir', work, '--dry-run'])
    expect(out).toContain('gh auth setup-git (adds gh as the github.com credential helper')
  })
})

describe('setup.sh host checks', () => {
  test('macOS offers Vagrant only and says why', () => {
    const { status, out } = run(['--dir', work, '--dry-run'], { FAKE_UNAME_S: 'Darwin' })
    expect(status).toBe(0)
    expect(out).toContain('Direct mode is not offered: this is macOS')
    expect(out).toContain('Mode:         vagrant')
  })

  test.each([
    ['macOS', '13', { FAKE_UNAME_S: 'Darwin' }, 'this is macOS'],
    ['Debian 12', '12', {}, 'direct mode needs Debian 13'],
    ['an LXC container', '13', { FAKE_CONTAINER: 'lxc' }, 'lxc container'],
  ])('refuses direct mode on %s', (_name, version: string, extra: Env, message) => {
    osIs('debian', version)
    const { status, out } = run(['--dir', work, '--yes', '--mode', 'direct'], extra)
    expect(status).toBe(1)
    expect(out).toContain(message)
    expect(existsSync(work)).toBe(false)
  })

  test('refuses a host the Vagrantfile does not support', () => {
    const { status, out } = setup({ FAKE_UNAME_S: 'FreeBSD' })
    expect(status).toBe(1)
    expect(out).toContain('Vagrant mode is not available')
  })

  test('--yes needs --mode where both modes are possible', () => {
    const { status, out } = run(['--dir', work, '--yes'])
    expect(status).toBe(1)
    expect(out).toContain('--yes needs --mode')
  })

  test('direct mode runs vm-bootstrap.sh through sudo with the repo folder', () => {
    const { status, out } = run(['--dir', work, '--yes', '--mode', 'direct'])
    expect(status, out).toBe(0)
    const sudo = readFileSync(join(root, 'gh.log.sudo'), 'utf8')
    expect(sudo).toContain(`TURBOPANEL_DEV_ROOT=${work}`)
    // The fixture dev repo has no vm-bootstrap.sh, so this checkout's copy runs.
    expect(sudo).toContain(`${REPO_ROOT}/scripts/vm-bootstrap.sh`)
    expect(modeFile()).toContain("TURBOPANEL_DEV_ENV='direct'")
    expect(out).toContain(`TURBOPANEL_DEV_ROOT='${work}'`)
    expect(out).not.toContain('until that lands')
  })
})

describe('setup.sh status and doctor', () => {
  test('status shows one row per repo, the open PR and the twin-branch order', () => {
    setup()
    for (const repo of ['turbopanel', 'turbopaneld']) {
      git(join(work, repo), 'branch', 'staging')
      git(join(work, repo), 'switch', '--quiet', '-c', 'feat/wire')
    }
    const { status, out } = run(['status', '--dir', work], { FAKE_GH_PR: '42' })
    expect(status, out).toBe(0)
    expect(out).toMatch(/turbopanel\s+maintainer\s+feat\/wire\s+\+0 -0\s+0\s+#42/)
    expect(out).toMatch(/ui\s+maintainer\s+trunk\s+\+0 -0\s+0\s+-/)
    expect(out).toContain('Branch feat/wire exists in: turbopanel turbopaneld.')
    expect(out).toContain(
      'merge the control plane (turbopanel) pull request before the daemon (turbopaneld) one'
    )
    expect(out).not.toContain('Branch staging')
    expect(ghLog()).toContain('pr list -R TurboPanel/turbopanel --head feat/wire')
  })

  test('doctor reports and changes nothing', () => {
    setup({ FAKE_GH_PUSH: 'false' })
    const before = modeFile()
    git(join(work, 'ui'), 'config', '--unset', 'core.hooksPath')
    git(join(work, 'website'), 'remote', 'remove', 'upstream')
    const { status, out } = run(['doctor', '--dir', work])
    expect(status).toBe(1)
    expect(out).toContain('VERSION_ID 13')
    expect(out).toContain('direct mode:  available')
    expect(out).toContain('login:        octo')
    expect(out).toContain('ui: core.hooksPath is unset')
    expect(out).toContain('website: contributor checkout without upstream')
    expect(out).toContain('commit.gpgsign')
    expect(modeFile()).toBe(before)
    expect(() => git(join(work, 'ui'), 'config', 'core.hooksPath')).toThrow()
  })

  test('doctor flags a direct-mode file on a host that cannot run it', () => {
    run(['--dir', work, '--yes', '--mode', 'direct'])
    osIs('debian', '12')
    const { status, out } = run(['doctor', '--dir', work])
    expect(status).toBe(1)
    expect(out).toContain('mode is direct but direct mode needs Debian 13')
    expect(out).toContain('Debian 12 here')
  })

  test('doctor compares owner and repo names without case', () => {
    setup()
    git(join(work, 'ui'), 'remote', 'set-url', 'origin', 'https://github.com/turbopanel/UI.git')
    const { out } = run(['doctor', '--dir', work])
    expect(out).not.toContain('ui: maintainer checkout whose origin')
  })

  test('doctor is clean after a fresh setup', () => {
    setup()
    const { status, out } = run(['doctor', '--dir', work])
    expect(status, out).toBe(0)
    expect(out).toContain('No problems found.')
  })
})

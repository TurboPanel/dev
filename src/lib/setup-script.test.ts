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
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = join(REPO_ROOT, 'scripts/setup.sh')
const PRIVILEGES = join(REPO_ROOT, 'scripts/lib/privileges.sh')
const SOURCE = readFileSync(SCRIPT, 'utf8')
const REPOS = ['dev', 'turbopanel', 'turbopaneld', 'ui', 'website', '.github']

// A fake gh driven by environment variables. It never talks to GitHub: forks
// are bare clones inside the fixture folder, listed in forks.txt as
// "<repo> <owner>/<name>". FAKE_GH_API_DOWN makes every API call fail.
const FAKE_GH = `#!/bin/sh
echo "gh $*" >> "$FAKE_GH_LOG"
[ "$1" != --version ] || { echo "gh version 9.9.9"; exit 0; }
forks="$FAKE_FIXTURE/forks.txt"
case "$1 $2" in
  "auth token" | "auth status") [ -n "$FAKE_GH_LOGIN" ] || exit 1; exit 0 ;;
  "auth setup-git") exit 0 ;;
  "auth login")
    echo "login prompts disabled: $GH_PROMPT_DISABLED" >> "$FAKE_GH_LOG"
    if [ -n "$FAKE_GH_LOGIN_FAILS" ]; then
      echo "could not prompt: unexpected escape sequence from terminal: ['\\x1b' ']']" >&2
      exit 1
    fi
    echo "! First copy your one-time code: ABCD-1234"
    exit 0 ;;
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
  if [ -n "$FAKE_GH_TOKEN_REVOKED" ]; then
    echo '{"message":"Bad credentials","status":"401"}'
    echo 'gh: Bad credentials (HTTP 401)' >&2
    exit 1
  fi
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
    // Never the host's file: a prepared dev VM has it and skips the bootstrap.
    TURBOPANEL_DIRECT_PROFILE_MARKER: join(root, 'no-direct-profile'),
    FAKE_FIXTURE: fixture,
    FAKE_GH_LOG: join(root, 'gh.log'),
    FAKE_GH_LOGIN: 'octo',
    FAKE_GH_PUSH: 'true',
    FAKE_GH_PROTOCOL: 'https',
    FAKE_GH_PR: '',
    FAKE_GH_API_DOWN: '',
    FAKE_GH_TOKEN_REVOKED: '',
    FAKE_UNAME_S: 'Linux',
    FAKE_BIN: bin,
    FAKE_GH_SOURCE: join(root, 'gh-fake'),
    FAKE_GH_INSTALLS: '1',
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

// A PATH with every system tool but gh (CI runners ship a real gh in
// /usr/bin), plus stubs for the tools the gh install uses.
const GH_KEY_FPR = '7F38BBB59D064DBCB3D84D725612B36462313325'
function withoutGh(): Env {
  const sys = join(root, 'sys')
  mkdirSync(sys)
  const seen = new Set<string>()
  for (const dir of ['/usr/local/bin', '/usr/bin', '/bin']) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (name === 'gh' || seen.has(name)) continue
      seen.add(name)
      symlinkSync(join(dir, name), join(sys, name))
    }
  }
  rmSync(join(bin, 'gh'))
  stub('apt-get', 'echo "apt-get $*" >> "$FAKE_GH_LOG.apt"; exit 0')
  stub('dpkg', 'printf "%s" "$FAKE_DPKG_ARCH"')
  stub(
    'curl',
    'echo "curl $*" >> "$FAKE_GH_LOG.apt"; while [ $# -gt 0 ]; do [ "$1" != -o ] || echo keyring > "$2"; shift; done'
  )
  stub(
    'gpg',
    [
      '[ -z "$FAKE_GPG_EMPTY" ] || exit 0',
      'printf "pub:-:4096:1:X:1:::-:::scESC:\\nfpr:::::::::%s:\\nsub:-:4096:1:Y:1::::::e:\\nfpr:::::::::SUBKEY:\\n" "$FAKE_GPG_FPR"',
      'printf "%b" "$FAKE_GPG_EXTRA"',
    ].join('\n')
  )
  mkdirSync(join(root, 'tmp'))
  return {
    PATH: `${bin}:${sys}`,
    TMPDIR: join(root, 'tmp'),
    FAKE_GPG_FPR: GH_KEY_FPR,
    FAKE_GPG_EXTRA: '',
    FAKE_GPG_EMPTY: '',
    FAKE_DPKG_ARCH: 'amd64',
  }
}

const sudoLog = () =>
  existsSync(join(root, 'gh.log.sudo')) ? readFileSync(join(root, 'gh.log.sudo'), 'utf8') : ''

const PORT_443_WEBSITE = 'ssh://git@ssh.github.com:443/TurboPanel/website.git'
const setOrigin = (repo: string, url: string) =>
  git(join(work, repo), 'remote', 'set-url', 'origin', url)

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
  writeFileSync(join(root, 'gh-fake'), FAKE_GH)
  // The fake sudo only logs; tee also logs what it was given, and installing gh
  // with apt puts the fake gh on the path.
  stub(
    'sudo',
    [
      'echo "sudo $*" >> "$FAKE_GH_LOG.sudo"',
      '[ "$1" != tee ] || cat >> "$FAKE_GH_LOG.sudo"',
      'if [ "$*" = "apt-get install -y gh" ] && [ -n "$FAKE_GH_INSTALLS" ]; then',
      '  cp "$FAKE_GH_SOURCE" "$FAKE_BIN/gh"; chmod 755 "$FAKE_BIN/gh"',
      'fi',
      'exit 0',
    ].join('\n')
  )
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

  test('no push access: read-only clones of TurboPanel and no forks', () => {
    const { status, out } = setup({ FAKE_GH_PUSH: 'false' })
    expect(status, out).toBe(0)
    for (const repo of REPOS) {
      const path = join(work, repo)
      expect(git(path, 'remote', 'get-url', 'origin')).toBe(
        `file://${fixture}/TurboPanel/${repo}.git`
      )
      expect(git(path, 'remote')).toBe('origin')
    }
    expect(ghLog()).not.toContain('repo fork')
    expect(ghLog()).not.toContain('set-default')
    expect(modeFile()).toContain("role_turbopanel='contributor'")
    expect(modeFile()).toContain("role_github='readonly'")
    expect(out).toContain('setup.sh fork ui when you want to push')
    expect(out).toContain(
      `Your repos are read-only clones of TurboPanel. When you are ready to push in one, run: ${work}/dev/scripts/setup.sh fork <repo>`
    )
    expect(out).toContain('Except: .github (read-only).')
  })

  test('--fork-all forks every repo but .github at setup and adds upstream', () => {
    const { status, out } = setup({ FAKE_GH_PUSH: 'false' }, ['--fork-all'])
    expect(status, out).toBe(0)
    for (const repo of REPOS.filter((name) => name !== '.github')) {
      const path = join(work, repo)
      expect(git(path, 'remote', 'get-url', 'origin')).toBe(`file://${fixture}/octo/${repo}.git`)
      expect(git(path, 'remote', 'get-url', 'upstream')).toBe(
        `file://${fixture}/TurboPanel/${repo}.git`
      )
      expect(git(path, 'rev-parse', '--abbrev-ref', 'trunk@{upstream}')).toBe('upstream/trunk')
      expect(ghLog()).toContain(`gh repo set-default TurboPanel/${repo}`)
    }
    expect(ghLog()).not.toContain('repo fork TurboPanel/.github')
    expect(ghLog()).not.toContain('set-default TurboPanel/.github')
    expect(existsSync(join(fixture, 'octo', '.github.git'))).toBe(false)
    expect(git(join(work, '.github'), 'remote')).toBe('origin')
    expect(modeFile()).toContain("role_turbopanel='contributor-fork'")
    expect(modeFile()).toContain("role_github='readonly'")
    expect(out).toContain(
      'You work from your own fork. Your repos push to your fork of each TurboPanel repo (origin); TurboPanel is upstream.'
    )
    expect(out).toContain('Except: .github (read-only).')
    expect(out.split('You work from your own fork').length - 1).toBe(1)
  })

  test('a failed gh repo set-default only warns', () => {
    writeFileSync(
      join(bin, 'gh'),
      FAKE_GH.replace(
        '"auth setup-git") exit 0 ;;',
        '"auth setup-git") exit 0 ;;\n  "repo set-default") exit 1 ;;'
      )
    )
    const { status, out } = setup({ FAKE_GH_PUSH: 'false' }, ['--fork-all'])
    expect(status, out).toBe(0)
    expect(out).toContain('ui: gh repo set-default TurboPanel/ui failed')
  })

  test('push access: the summary says so once, with no exceptions', () => {
    const { out } = setup()
    expect(out).toContain('You can push to TurboPanel directly.')
    expect(out).toContain(
      `To work from your own fork instead, run: ${work}/dev/scripts/setup.sh fork <repo>`
    )
    expect(out).not.toContain('Except:')
    expect(ghLog()).not.toContain('set-default')
  })

  test('--as-contributor gives a maintainer the read-only clones a contributor gets', () => {
    const { status, out } = setup({}, ['--as-contributor'])
    expect(status, out).toBe(0)
    expect(git(join(work, 'ui'), 'remote', 'get-url', 'origin')).toContain('/TurboPanel/ui.git')
    expect(ghLog()).not.toContain('repo fork')
    expect(modeFile()).toContain("role_ui='contributor'")
  })

  test('--as-contributor with --fork-all forks even with push access', () => {
    const { status, out } = setup({}, ['--as-contributor', '--fork-all'])
    expect(status, out).toBe(0)
    expect(git(join(work, 'ui'), 'remote', 'get-url', 'origin')).toContain('/octo/ui.git')
    expect(modeFile()).toContain("role_ui='contributor-fork'")
  })

  test('--fork still works but points at --as-contributor', () => {
    const { status, out } = setup({}, ['--fork'])
    expect(status, out).toBe(0)
    expect(out).toContain('--fork is now --as-contributor')
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
    expect(setup({ FAKE_GH_PUSH: 'false' }, ['--fork-all']).status).toBe(0)
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
    const { status, out } = setup({ FAKE_GH_PUSH: 'false' }, ['--fork-all'])
    expect(status, out).toBe(0)
    expect(git(join(work, 'ui'), 'remote', 'get-url', 'origin')).toBe(
      `file://${fixture}/octo/my-ui.git`
    )
    expect(ghLog()).not.toContain('repo fork TurboPanel/ui')
  })

  test('a fork that never appears fails that repo within the wait', () => {
    const started = Date.now()
    const { status, out } = setup(
      { FAKE_GH_PUSH: 'false', FAKE_GH_FORK_NOOP: '1', TURBOPANEL_SETUP_FORK_WAIT: '0' },
      ['--fork-all']
    )
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
    expect(out).toContain(
      "You are not signed in to GitHub, so the repos are read-only. Run 'gh auth login --hostname github.com --git-protocol https --web --scopes workflow' and rerun this script."
    )
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

  test('logging in later keeps read-only clones until fork', () => {
    setup({ FAKE_GH_LOGIN: '' })
    const { status, out } = setup({ FAKE_GH_PUSH: 'false' })
    expect(status, out).toBe(0)
    const ui = join(work, 'ui')
    expect(git(ui, 'remote')).toBe('origin')
    expect(modeFile()).toContain("role_ui='contributor'")
    expect(run(['fork', 'ui', '--dir', work], { FAKE_GH_PUSH: 'false' }).status).toBe(0)
    expect(git(ui, 'remote', 'get-url', 'origin')).toContain('/octo/ui.git')
    expect(git(ui, 'remote', 'get-url', 'upstream')).toContain('/TurboPanel/ui.git')
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

  test('a revoked token reads as logged out, not offline', () => {
    setup({ FAKE_GH_PUSH: 'false' })
    const { status, out } = setup({ FAKE_GH_TOKEN_REVOKED: '1' })
    expect(status, out).toBe(0)
    expect(out).toContain('GitHub refused the saved gh token (revoked or expired)')
    expect(out).toContain('gh auth login --hostname github.com')
    expect(out).not.toContain('GitHub did not answer')
    expect(modeFile()).toContain("github_login=''")
  })

  test('an origin setup cannot read as GitHub is warned about and kept', () => {
    setup()
    const ui = join(work, 'ui')
    setOrigin('ui', 'git@gh-alias:TurboPanel/ui.git')
    const { out } = setup()
    expect(out).toContain(
      'ui: origin git@gh-alias:TurboPanel/ui.git is not a GitHub address setup recognises'
    )
    expect(out).toContain('an ssh config host alias is not followed); left as it is.')
    expect(git(ui, 'remote', 'get-url', 'origin')).toBe('git@gh-alias:TurboPanel/ui.git')
  })

  test('an unreadable origin on a fork-shaped checkout is warned about too', () => {
    setup()
    const ui = join(work, 'ui')
    git(ui, 'remote', 'add', 'upstream', git(ui, 'remote', 'get-url', 'origin'))
    setOrigin('ui', 'git@gh-alias:octo/ui.git')
    const { out } = setup()
    expect(out).toContain('ui: origin git@gh-alias:octo/ui.git is not a GitHub address')
  })

  test('a token in an unreadable origin is never printed', () => {
    setup()
    setOrigin('ui', 'https://x-access-token:s3cr3tvalue@git.example.invalid/TurboPanel/ui.git')
    const { out } = setup()
    expect(out).toContain('origin https://git.example.invalid/TurboPanel/ui.git is not a GitHub')
    expect(out).not.toContain('s3cr3tvalue')
    expect(run(['doctor', '--dir', work]).out).not.toContain('s3cr3tvalue')
  })

  test('the fork plan names no fork address, since a fork can be renamed', () => {
    const { status, out } = run(['--dir', work, '--dry-run', '--fork-all'], {
      FAKE_GH_PUSH: 'false',
    })
    expect(status, out).toBe(0)
    expect(out).toContain('fork TurboPanel/ui to your account (or reuse your fork, renamed or not)')
    expect(out).not.toContain('octo/ui')
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

describe('setup.sh in an old Vagrant guest', () => {
  // A guest made before the repos moved still mounts them at ~/<repo>, so the
  // dev checkout sits directly in the home folder with no mode file next to it.
  function oldGuestCheckout(): string {
    const dev = join(root, 'old-guest-home', 'dev')
    mkdirSync(join(dev, 'scripts', 'lib'), { recursive: true })
    for (const file of ['scripts/setup.sh', 'scripts/lib/privileges.sh', 'repos.list']) {
      writeFileSync(join(dev, file), readFileSync(join(REPO_ROOT, file)))
    }
    return join(dev, 'scripts', 'setup.sh')
  }

  test('stops with the rebuild steps instead of picking a folder', () => {
    const marker = join(root, 'turbopanel-vagrant.sh')
    writeFileSync(marker, '# guest\n')
    const result = spawnSync('sh', [oldGuestCheckout(), '--dry-run'], {
      cwd: root,
      encoding: 'utf8',
      env: baseEnv({ TURBOPANEL_VAGRANT_GUEST_MARKER: marker }),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const out = `${result.stdout}${result.stderr}`
    expect(result.status, out).toBe(1)
    expect(out).toContain('this Vagrant guest still mounts the repos at ~/<repo>')
    expect(out).toContain('vagrant destroy -f && vagrant up')
  })

  test('outside the guest the same checkout is not refused for being a guest', () => {
    const result = spawnSync('sh', [oldGuestCheckout(), '--dry-run'], {
      cwd: root,
      encoding: 'utf8',
      env: baseEnv({ TURBOPANEL_VAGRANT_GUEST_MARKER: join(root, 'no-marker') }),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    expect(`${result.stdout}${result.stderr}`).not.toContain('this Vagrant guest')
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
    // The console reads the folder from the mode file, so no env prefix.
    expect(out).toContain(`'${work}/dev/console'`)
    expect(out).not.toContain(`TURBOPANEL_DEV_ROOT='${work}'`)
    expect(out).not.toContain('until that lands')
  })

  test('refuses a folder that is itself a git checkout (the old home-folder layout)', () => {
    mkdirSync(join(work, '.git'), { recursive: true })
    const { status, out } = run(['--dir', work, '--yes', '--mode', 'vagrant'])
    expect(status).toBe(1)
    expect(out).toContain('is a git checkout, not the folder that holds the repos')
    expect(out).toContain('mv tp-move turbopanel')
  })

  test('direct mode refuses a folder that is not named turbopanel', () => {
    const other = join(root, 'repos')
    const { status, out } = run(['--dir', other, '--yes', '--mode', 'direct'])
    expect(status).toBe(1)
    expect(out).toContain('folder named turbopanel')
    expect(out).toContain(other)
  })
})

describe('setup.sh GitHub CLI', () => {
  test('--yes installs a missing gh from the official apt source but never logs in', () => {
    const { status, out } = setup({ ...withoutGh(), FAKE_GH_LOGIN: '' })
    expect(status, out).toBe(0)
    const sudo = sudoLog()
    expect(sudo).toContain('sudo install -d -m 0755 /etc/apt/keyrings')
    expect(sudo).toMatch(
      /sudo install -m 0644 \S+\/keyring\.gpg \/etc\/apt\/keyrings\/githubcli-archive-keyring\.gpg/
    )
    expect(sudo).toContain(
      'deb [arch=amd64 signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main'
    )
    expect(sudo).toContain('sudo tee /etc/apt/sources.list.d/github-cli.list')
    expect(sudo.indexOf('sudo apt-get update')).toBeLessThan(
      sudo.indexOf('sudo apt-get install -y gh')
    )
    expect(out).toContain('Installed gh version 9.9.9')
    expect(readdirSync(join(root, 'tmp'))).toEqual([])
    expect(ghLog()).not.toContain('auth login')
    expect(out).toContain(
      "Run 'gh auth login --hostname github.com --git-protocol https --web --scopes workflow'"
    )
  })

  test('a signing key that does not match the published fingerprints stops the install', () => {
    const { status, out } = setup({ ...withoutGh(), FAKE_GPG_FPR: 'DEADBEEF' })
    expect(status, out).toBe(0)
    expect(out).toContain('unexpected GitHub CLI signing key DEADBEEF')
    expect(out).toContain('does not match the published fingerprints')
    expect(sudoLog()).not.toContain('apt-get install -y gh')
    expect(sudoLog()).not.toContain('github-cli.list')
    expect(out).toContain('gh is still not installed')
  })

  test.each([
    [
      'an extra primary key',
      {
        FAKE_GPG_EXTRA:
          'pub:-:4096:1:Z:1:::-:::scESC:\\nfpr:::::::::0123456789ABCDEF0123456789ABCDEF01234567:\\n',
      },
      'unexpected GitHub CLI signing key 0123456789ABCDEF',
    ],
    [
      'a primary key without a fingerprint line',
      { FAKE_GPG_EXTRA: 'pub:-:4096:1:Z:1:::-:::scESC:\\nuid:-::::1::A::B:\\n' },
      'not a plain set of public keys',
    ],
    [
      'a secret key next to the good one',
      {
        FAKE_GPG_EXTRA: `sec:u:4096:1:Z:1:::u:::scESC:\\nfpr:::::::::${GH_KEY_FPR}:\\nssb:u:4096:1:W:1::::::e:\\n`,
      },
      'not a plain set of public keys',
    ],
    ['no keys at all', { FAKE_GPG_EMPTY: '1' }, 'not a plain set of public keys'],
    ['an empty architecture', { FAKE_DPKG_ARCH: '' }, 'did not report this machine'],
  ])('%s stops the install before apt changes', (_name, extra: Env, message) => {
    const { status, out } = setup({ ...withoutGh(), ...extra })
    expect(status, out).toBe(0)
    expect(out).toContain(message)
    expect(sudoLog()).not.toContain('githubcli-archive-keyring.gpg')
    expect(sudoLog()).not.toContain('apt-get install -y gh')
    expect(out).toContain('gh is still not installed')
    expect(readdirSync(join(root, 'tmp'))).toEqual([])
  })

  test.each([
    ['Debian', {}, 'offer to install gh from the official apt source', true],
    ['macOS', { FAKE_UNAME_S: 'Darwin' }, "install it with 'brew install gh'", false],
    ['FreeBSD', { FAKE_UNAME_S: 'FreeBSD' }, 'install it from https://cli.github.com', false],
  ])('a dry run on %s lists the gh step and changes nothing', (_name, extra: Env, line, login) => {
    const { status, out } = run(['--dir', work, '--dry-run'], { ...withoutGh(), ...extra })
    expect(status, out).toBe(0)
    expect(out).toContain(line)
    expect(out.includes("GitHub login: offer 'gh auth login'")).toBe(login)
    expect(sudoLog()).toBe('')
    expect(existsSync(join(root, 'gh.log.apt'))).toBe(false)
  })

  test('a dry run with --yes says the login is left to you', () => {
    const { out } = run(['--dir', work, '--dry-run', '--yes'], { FAKE_GH_LOGIN: '' })
    expect(out).toContain(
      "--yes never runs 'gh auth login', run it yourself: gh auth login --hostname github.com --git-protocol https --web --scopes workflow"
    )
    expect(ghLog()).not.toContain('auth login')
  })

  test('Ubuntu counts as an apt host', () => {
    osIs('ubuntu', '24.04')
    const { out } = run(['--dir', work, '--dry-run', '--mode', 'vagrant'], withoutGh())
    expect(out).toContain('offer to install gh from the official apt source')
  })

  // setsid -w starts a new session with no controlling terminal, so no prompt can open.
  test.skipIf(spawnSync('setsid', ['-w', 'true']).status !== 0)(
    'without a terminal and without --yes a missing gh only warns',
    () => {
      const result = spawnSync('setsid', ['-w', 'sh', SCRIPT, '--dir', work, '--mode', 'vagrant'], {
        encoding: 'utf8',
        env: baseEnv(withoutGh()),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      expect(`${result.stdout}${result.stderr}`).toContain(
        'Rerun in a terminal or with --yes to install it'
      )
      expect(sudoLog()).toBe('')
      expect(ghLog()).not.toContain('auth login')
    }
  )
})

const count = (text: string, needle: string) => text.split(needle).length - 1

describe('setup.sh fork', () => {
  const fork = (names: string[], extra: Env = {}) =>
    run(['fork', ...names, '--dir', work], { FAKE_GH_PUSH: 'false', ...extra })

  test('forks only the named repo, keeps its branches and is a no-op the second time', () => {
    setup({ FAKE_GH_PUSH: 'false' })
    const ui = join(work, 'ui')
    git(ui, 'switch', '--quiet', '-c', 'feature')
    writeFileSync(join(ui, 'wip.txt'), 'wip\n')
    git(ui, 'add', 'wip.txt')
    git(ui, 'commit', '--quiet', '-m', 'wip')
    const head = git(ui, 'rev-parse', 'HEAD')

    const { status, out } = fork(['ui'])
    expect(status, out).toBe(0)
    expect(git(ui, 'remote', 'get-url', 'origin')).toBe(`file://${fixture}/octo/ui.git`)
    expect(git(ui, 'remote', 'get-url', 'upstream')).toBe(`file://${fixture}/TurboPanel/ui.git`)
    expect(git(ui, 'rev-parse', '--abbrev-ref', 'trunk@{upstream}')).toBe('upstream/trunk')
    expect(git(ui, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(ui, 'branch', '--show-current')).toBe('feature')
    expect(git(join(work, 'website'), 'remote')).toBe('origin')
    expect(ghLog()).toContain('repo fork TurboPanel/ui')
    expect(ghLog()).not.toContain('repo fork TurboPanel/website')
    expect(ghLog()).toContain('repo set-default TurboPanel/ui')
    expect(modeFile()).toContain("role_ui='contributor-fork'")
    expect(modeFile()).toContain("role_website='contributor'")
    expect(modeFile()).toContain("TURBOPANEL_DEV_ENV='vagrant'")

    const again = fork(['ui'])
    expect(again.status, again.out).toBe(0)
    expect(again.out).toContain('ui: already forked')
    expect(count(ghLog(), 'repo fork TurboPanel/ui')).toBe(1)

    const table = run(['status', '--dir', work]).out
    expect(table).toMatch(/^ui\s+forked\s+feature/m)
    expect(table).toMatch(/^website\s+read-only\s+trunk/m)
  })

  test('--dry-run prints the plan and makes no GitHub call or remote change', () => {
    setup({ FAKE_GH_PUSH: 'false' })
    rmSync(join(root, 'gh.log'))
    const { status, out } = run(['fork', 'ui', 'website', '--dry-run', '--dir', work], {
      FAKE_GH_PUSH: 'false',
    })
    expect(status, out).toBe(0)
    expect(out).toContain('ui: fork TurboPanel/ui to your account')
    expect(out).toContain('Dry run: nothing changed.')
    expect(ghLog()).toBe('')
    expect(git(join(work, 'ui'), 'remote')).toBe('origin')
    expect(modeFile()).toContain("role_ui='contributor'")
  })

  test('an upstream pointing elsewhere stops before any fork is made', () => {
    setup({ FAKE_GH_PUSH: 'false' })
    git(join(work, 'ui'), 'remote', 'add', 'upstream', 'https://github.com/someone/ui.git')
    const { status, out } = fork(['ui'])
    expect(status).toBe(1)
    expect(out).toContain('an upstream remote already points to https://github.com/someone/ui.git')
    expect(ghLog()).not.toContain('repo fork TurboPanel/ui')
    expect(git(join(work, 'ui'), 'remote', 'get-url', 'origin')).toContain('/TurboPanel/ui.git')
  })

  test('a TurboPanel path on another host is not TurboPanel', () => {
    setup()
    const ui = join(work, 'ui')
    git(ui, 'remote', 'set-url', 'origin', 'https://evil.example/TurboPanel/ui.git')
    expect(run(['doctor', '--dir', work]).out).toContain(
      'ui: maintainer checkout whose origin is not TurboPanel/ui'
    )
    const { status, out } = fork(['ui'])
    expect(status).toBe(1)
    expect(out).toContain('origin is https://evil.example/TurboPanel/ui.git, not TurboPanel/ui')
    expect(ghLog()).not.toContain('repo fork TurboPanel/ui')
  })

  test('repo names are never expanded as file patterns', () => {
    setup({ FAKE_GH_PUSH: 'false' })
    expect(fork(['*']).out).toContain('unknown repo *;')
  })

  test('refuses when not signed in to GitHub and changes nothing', () => {
    setup({ FAKE_GH_PUSH: 'false' })
    const { status, out } = fork(['ui'], { FAKE_GH_LOGIN: '' })
    expect(status).toBe(1)
    expect(out).toContain(
      "you are not signed in to GitHub; run 'gh auth login --hostname github.com --git-protocol https --web --scopes workflow' in a plain SSH terminal"
    )
    expect(git(join(work, 'ui'), 'remote')).toBe('origin')
  })

  test('refuses offline and changes nothing', () => {
    setup({ FAKE_GH_PUSH: 'false' })
    const { status, out } = fork(['ui'], { FAKE_GH_API_DOWN: '1' })
    expect(status).toBe(1)
    expect(out).toContain('GitHub did not answer')
    expect(git(join(work, 'ui'), 'remote')).toBe('origin')
    expect(ghLog()).not.toContain('repo fork')
  })

  test('finds a renamed fork through the fork list', () => {
    setup({ FAKE_GH_PUSH: 'false' })
    execFileSync('git', [
      'clone',
      '--quiet',
      '--bare',
      join(fixture, 'TurboPanel', 'ui.git'),
      join(fixture, 'octo', 'my-ui.git'),
    ])
    writeFileSync(join(fixture, 'forks.txt'), 'ui octo/my-ui\n')
    const { status, out } = fork(['ui'])
    expect(status, out).toBe(0)
    expect(git(join(work, 'ui'), 'remote', 'get-url', 'origin')).toBe(
      `file://${fixture}/octo/my-ui.git`
    )
    expect(ghLog()).not.toContain('repo fork TurboPanel/ui')
  })

  test('a fork that never appears leaves the checkout as it was', () => {
    setup({ FAKE_GH_PUSH: 'false' })
    const { status, out } = fork(['ui'], {
      FAKE_GH_FORK_NOOP: '1',
      TURBOPANEL_SETUP_FORK_WAIT: '0',
    })
    expect(status).toBe(1)
    expect(out).toContain('your fork of TurboPanel/ui was not ready within 0s')
    expect(out).toContain('Rerun later (setup.sh fork ui')
    expect(git(join(work, 'ui'), 'remote')).toBe('origin')
    expect(modeFile()).toContain("role_ui='contributor'")
  })

  test('.github is forked only when named', () => {
    setup({ FAKE_GH_PUSH: 'false' }, ['--fork-all'])
    expect(ghLog()).not.toContain('repo fork TurboPanel/.github')
    const { status, out } = fork(['.github'])
    expect(status, out).toBe(0)
    expect(git(join(work, '.github'), 'remote', 'get-url', 'origin')).toContain('/octo/.github.git')
    expect(modeFile()).toContain("role_github='contributor-fork'")
  })

  test('needs repo names from repos.list and a setup first', () => {
    expect(run(['fork', '--dir', work]).status).toBe(2)
    expect(fork(['nope']).out).toContain('unknown repo nope')
    expect(fork(['ui']).out).toContain('setup.sh first')
  })

  test('a fork checkout from an older mode file still counts as forked', () => {
    setup({ FAKE_GH_PUSH: 'false' }, ['--fork-all'])
    const file = join(work, '.turbopanel-dev-mode')
    writeFileSync(file, modeFile().replaceAll("'contributor-fork'", "'contributor'"))
    const table = run(['status', '--dir', work]).out
    expect(table).toMatch(/^ui\s+forked/m)
    const { status, out } = run(['doctor', '--dir', work])
    expect(status, out).toBe(0)
    expect(out).not.toContain('to push:')
  })

  test('doctor names the fork command for read-only clones and stays clean', () => {
    setup({ FAKE_GH_PUSH: 'false' })
    const { status, out } = run(['doctor', '--dir', work])
    expect(status, out).toBe(0)
    expect(out).toContain('ui (contributor, read-only)')
    expect(out).toContain(`to push:    ${work}/dev/scripts/setup.sh fork ui`)
    expect(out).toContain('No problems found.')
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
    expect(out).toContain('You can push to TurboPanel directly.')
  })

  test('doctor reports and changes nothing', () => {
    setup({ FAKE_GH_PUSH: 'false' }, ['--fork-all'])
    const before = modeFile()
    git(join(work, 'ui'), 'config', '--unset', 'core.hooksPath')
    git(join(work, 'website'), 'remote', 'remove', 'upstream')
    const { status, out } = run(['doctor', '--dir', work])
    expect(status).toBe(1)
    expect(out).toContain('VERSION_ID 13')
    expect(out).toContain('direct mode:  available')
    expect(out).toContain('login:        octo')
    expect(out).toContain('ui: core.hooksPath is unset')
    expect(out).toContain('website: fork checkout without upstream')
    expect(out).toContain('commit.gpgsign')
    expect(modeFile()).toBe(before)
    expect(() => git(join(work, 'ui'), 'config', 'core.hooksPath')).toThrow()
  })

  test('doctor warns about an origin it cannot read for every role and reads the port 443 form', () => {
    setup({ FAKE_GH_PUSH: 'false' })
    setOrigin('ui', 'git@gh-alias:TurboPanel/ui.git')
    setOrigin('website', PORT_443_WEBSITE)
    const { status, out } = run(['doctor', '--dir', work])
    expect(status, out).toBe(0)
    expect(out).toContain('ui: origin git@gh-alias:TurboPanel/ui.git is not a GitHub address')
    expect(out).not.toContain('website: origin')
  })

  test.each([
    PORT_443_WEBSITE,
    'ssh://ssh.github.com:443/TurboPanel/website.git',
    'ssh://git@ssh.github.com/TurboPanel/website.git',
  ])('doctor reads %s as TurboPanel for a maintainer', (url) => {
    setup()
    setOrigin('website', url)
    const { status, out } = run(['doctor', '--dir', work])
    expect(status, out).toBe(0)
    expect(out).not.toContain('website: maintainer checkout whose origin')
    expect(out).not.toContain('website: origin')
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

  test('doctor only warns about a custom core.hooksPath', () => {
    setup()
    git(join(work, 'ui'), 'config', 'core.hooksPath', 'myhooks')
    const { status, out } = run(['doctor', '--dir', work])
    expect(status, out).toBe(0)
    expect(out).toContain('ui: core.hooksPath is myhooks, not .githooks')
    expect(out).toContain('No problems found.')
  })

  test('doctor is clean after a fresh setup', () => {
    setup()
    const { status, out } = run(['doctor', '--dir', work])
    expect(status, out).toBe(0)
    expect(out).toContain('No problems found.')
  })
})

// util-linux script(1) gives setup.sh a real terminal, so the login offer and
// the questions run as they do for a person. Skipped where it is missing.
const hasUtilLinuxScript =
  spawnSync('script', ['--version'], { encoding: 'utf8' }).stdout?.includes('util-linux') ?? false

describe.skipIf(!hasUtilLinuxScript)('setup.sh GitHub login on a terminal', () => {
  const onTty = (input: string, extra: Env = {}) => {
    const result = spawnSync('script', ['-qec', 'sh "$TP_SETUP" --dir "$TP_WORK"', '/dev/null'], {
      encoding: 'utf8',
      env: baseEnv({ SHELL: '/bin/sh', TP_SETUP: SCRIPT, TP_WORK: work, ...extra }),
      input,
      timeout: 60_000,
    })
    return { status: result.status, out: `${result.stdout}${result.stderr}` }
  }

  test('gh runs with every question answered by flags and no prompts', () => {
    const { status, out } = onTty('y\n1\ny\n', { FAKE_GH_LOGIN: '' })
    expect(status, out).toBe(0)
    expect(ghLog()).toContain(
      'gh auth login --hostname github.com --git-protocol https --web --scopes workflow'
    )
    expect(ghLog()).toContain('login prompts disabled: 1')
    expect(out).toContain('First copy your one-time code')
  })

  test('a login that fails like a terminal answering late never stops setup', () => {
    const { status, out } = onTty('y\n1\ny\n', { FAKE_GH_LOGIN: '', FAKE_GH_LOGIN_FAILS: '1' })
    expect(status, out).toBe(0)
    expect(out).toContain('could not prompt: unexpected escape sequence from terminal')
    expect(out).toContain('gh auth login did not finish; setup goes on with read-only clones.')
    expect(out).toContain(
      'run this in a plain SSH terminal (it may ask a question or two there), then rerun this script:'
    )
    expect(out).toContain(
      '    gh auth login --hostname github.com --git-protocol https --web --scopes workflow'
    )
    expect(out).toContain('How do you want to run TurboPanel?')
    for (const repo of REPOS) {
      expect(git(join(work, repo), 'remote')).toBe('origin')
    }
    expect(modeFile()).toContain("role_ui='readonly'")
  })

  test('an earlier ssh choice is kept and no key is generated', () => {
    const { status, out } = onTty('y\n1\ny\n', { FAKE_GH_LOGIN: '', FAKE_GH_PROTOCOL: 'ssh' })
    expect(status, out).toBe(0)
    expect(ghLog()).toContain(
      'gh auth login --hostname github.com --git-protocol ssh --web --scopes workflow --skip-ssh-key'
    )
  })
})

describe('terminal replies in typed answers', () => {
  const strip = (value: string) =>
    execFileSync('sh', ['-c', '. "$1"; tp_strip_terminal_replies "$2"', 'sh', PRIVILEGES, value], {
      encoding: 'utf8',
    })

  test.each([
    ['y', 'y'],
    ['\x1b]11;rgb:0000/0000/0000\x1b\\y', 'y'],
    ['11;rgb:0000/0000/0000\x1b\\Y', 'Y'],
    ['\x1b]11;rgb:1/2/3\x07n', 'n'],
    ['\x1b[1;1R1', '1'],
    ['\x1b]11;rgb:0000/0000/0000', ''],
    ['\x1b]11;rgb:0000/0000/0000y', 'y'],
    ['11;rgb:0000/0000/00001', '1'],
    ['\x1b]11;rgb:00/00/001', '1'],
  ])('%j reads as %j', (typed, answer) => {
    expect(strip(typed)).toBe(answer)
  })
})

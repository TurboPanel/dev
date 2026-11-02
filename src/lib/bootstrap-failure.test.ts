import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BOOTSTRAP_STDERR_TAIL_LINES,
  BootstrapOutputCollector,
  formatBootstrapFailure,
  writeBootstrapLog,
} from './bootstrap-failure.ts'

// The shape the owner saw: the daemon's installer prints the failure, then the
// last lines of uv's output, all on stderr.
function ownerRun(): BootstrapOutputCollector {
  const collected = new BootstrapOutputCollector()
  collected.add('stdout', '▸ Fetching orchestration components')
  collected.add('stderr', 'Resolved 42 packages in 1.2s')
  collected.add(
    'stderr',
    '✗ Command failed (exit 2): /opt/turbopanel/vendor/uv/current/uv pip install --python /opt/turbopanel/runtimes/ansible/venv --requirements requirements.txt'
  )
  for (const pkg of ['ansible-core==2.20.0', 'ansible-lint==26.1.0', 'yamllint==1.38.0']) {
    collected.add('stderr', `  + ${pkg}`)
  }
  return collected
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('BootstrapOutputCollector', () => {
  it("reports the daemon's failure line, not the last line printed", () => {
    const collected = ownerRun()
    expect(collected.failureMessage()).toBe(
      'Command failed (exit 2): /opt/turbopanel/vendor/uv/current/uv pip install --python /opt/turbopanel/runtimes/ansible/venv --requirements requirements.txt'
    )
    expect(collected.stderrTail().at(-1)).toBe('+ yamllint==1.38.0')
  })

  it('reads the [bootstrap] form the daemon prints without its installer view', () => {
    const collected = new BootstrapOutputCollector()
    collected.add('stderr', '[bootstrap] uv missing at /opt/turbopanel/vendor/uv/current/uv')
    collected.add('stderr', 'trailing noise')
    expect(collected.failureMessage()).toBe('uv missing at /opt/turbopanel/vendor/uv/current/uv')
  })

  it('falls back to the last stderr line, then stdout, then a fixed message', () => {
    const stderrOnly = new BootstrapOutputCollector()
    stderrOnly.add('stderr', 'something broke')
    expect(stderrOnly.failureMessage()).toBe('something broke')

    const stdoutOnly = new BootstrapOutputCollector()
    stdoutOnly.add('stdout', 'last words')
    expect(stdoutOnly.failureMessage()).toBe('last words')

    expect(new BootstrapOutputCollector().failureMessage()).toBe('Bootstrap orchestration failed')
  })

  it('keeps only the last stderr lines but every line for the log', () => {
    const collected = new BootstrapOutputCollector()
    for (let index = 0; index < 50; index += 1) collected.add('stderr', `line ${index}`)
    collected.add('stdout', 'out line')
    collected.add('stderr', '   ')
    expect(collected.stderrTail()).toHaveLength(BOOTSTRAP_STDERR_TAIL_LINES)
    expect(collected.stderrTail()[0]).toBe(`line ${50 - BOOTSTRAP_STDERR_TAIL_LINES}`)
    expect(collected.lines()).toHaveLength(51)
    expect(collected.lines().at(-1)).toBe('out| out line')
    expect(collected.lines()[0]).toBe('err| line 0')
  })
})

describe('formatBootstrapFailure', () => {
  it('names the exit status, the failure and the full log', () => {
    expect(
      formatBootstrapFailure({ failure: 'uv pip install failed', code: 1, logPath: '/x/boot.log' })
    ).toBe('Bootstrap failed (exit 1): uv pip install failed\nFull output: /x/boot.log')
  })

  it('names a signal and leaves out a log that could not be written', () => {
    expect(
      formatBootstrapFailure({ failure: 'stopped', code: null, signal: 'SIGTERM', logPath: null })
    ).toBe('Bootstrap failed (signal SIGTERM): stopped')
  })
})

describe('writeBootstrapLog', () => {
  it('writes every line with a timestamp', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-boot-'))
    dirs.push(dir)
    const path = join(dir, 'nested', 'bootstrap-orchestration.log')
    const written = await writeBootstrapLog(
      path,
      ownerRun().lines(),
      new Date('2026-11-02T00:00:00Z')
    )
    expect(written).toBe(path)
    const body = readFileSync(path, 'utf8')
    expect(body.startsWith('time=2026-11-02T00:00:00.000Z\n')).toBe(true)
    expect(body).toContain('err| ✗ Command failed (exit 2)')
    expect(body).toContain('err|   + yamllint==1.38.0')
  })

  it('falls back to the temp folder when the log folder cannot be written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-boot-'))
    dirs.push(dir)
    const blocker = join(dir, 'not-a-folder')
    writeFileSync(blocker, '')
    const written = await writeBootstrapLog(join(blocker, 'boot.log'), ['out| hi'])
    expect(written).toBe(join(tmpdir(), 'turbopanel-bootstrap-orchestration.log'))
    expect(readFileSync(written!, 'utf8')).toContain('out| hi')
  })
})

import { EventEmitter } from 'node:events'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// A fixed folder: vi.mock factories run before any top-level code.
const logDir = join(tmpdir(), 'tp-boot-wire-test')

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn() }
})
vi.mock('./turbopanel-permissions.ts', () => ({ ensureFhsTreeOwnership: vi.fn() }))
vi.mock('./daemon-exec.ts', () => ({
  ensureBootstrapDeno: vi.fn(),
  bootstrapOrchestrationCommand: () => 'deno run bootstrap.ts',
}))
vi.mock('./paths.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./paths.ts')>()
  const os = await import('node:os')
  const path = await import('node:path')
  return {
    ...actual,
    CONSOLE_BOOTSTRAP_LOG: path.join(
      os.tmpdir(),
      'tp-boot-wire-test',
      'bootstrap-orchestration.log'
    ),
  }
})

import { spawn } from 'node:child_process'
import { bootstrapOrchestration } from './daemon-install.ts'

afterAll(() => {
  rmSync(logDir, { recursive: true, force: true })
})

function fakeChild(stderr: string[], code: number) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  setImmediate(() => {
    child.stdout.emit('data', '{"event":"ignored"}\n▸ Fetching orchestration components\n')
    for (const chunk of stderr) child.stderr.emit('data', chunk)
    child.emit('close', code, null)
  })
  return child
}

describe('bootstrapOrchestration failure', () => {
  it("rejects with the daemon's failure and the full log, not uv's last line", async () => {
    vi.mocked(spawn).mockReturnValue(
      fakeChild(
        [
          '✗ Command failed (exit 2): uv pip install --requirements requirements.txt\n  + ansible-core==2.20.0\n',
          '  + yamllint==1.38.0\n',
        ],
        1
      ) as never
    )
    const output: string[] = []
    const events: unknown[] = []
    await expect(
      bootstrapOrchestration(
        (event) => events.push(event),
        (line) => output.push(line)
      )
    ).rejects.toThrow(
      new Error(
        `Bootstrap failed (exit 1): Command failed (exit 2): uv pip install --requirements requirements.txt\nFull output: ${logDir}/bootstrap-orchestration.log`
      )
    )
    expect(events).toEqual([{ event: 'ignored' }])
    expect(output.at(-1)).toBe('+ yamllint==1.38.0')
    const log = readFileSync(`${logDir}/bootstrap-orchestration.log`, 'utf8')
    expect(log).toContain('out| ▸ Fetching orchestration components')
    expect(log).toContain('err|   + yamllint==1.38.0')
  })

  it('resolves on success', async () => {
    vi.mocked(spawn).mockReturnValue(fakeChild([], 0) as never)
    await expect(bootstrapOrchestration(() => undefined)).resolves.toBeUndefined()
  })
})

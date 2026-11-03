import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEV_HOST_FAILED_VISIBLE_MS,
  DEV_HOST_STALE_MS,
  DEV_HOST_STATUS_PATH,
  type DevHostJob,
  type DevHostPart,
  devHostActionLabel,
  devHostJobLine,
  devHostPartForService,
  devHostRowSuffix,
  devHostRowSuffixes,
  devHostStepLabel,
  isDevHostJobRunning,
  isDevHostStatusStale,
  parseDevHostStatus,
  readDevHostStatus,
} from './dev-host-status.ts'

const NOW = Date.parse('2026-11-03T12:00:00Z')
const SHA = 'a'.repeat(40)

function rawPart(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'control-plane',
    unit: 'turbopanel-instance',
    branch: 'trunk',
    onTrunk: true,
    headCommit: SHA,
    runningCommit: SHA,
    behindBy: 0,
    dirty: { files: 0, blocking: false, kinds: [] },
    restartNeeded: false,
    setupNeeded: {},
    active: true,
    ...overrides,
  }
}

function part(overrides: Partial<DevHostPart> = {}): DevHostPart {
  return {
    name: 'control-plane',
    unit: 'turbopanel-instance',
    branch: 'trunk',
    onTrunk: true,
    headCommit: SHA,
    behindBy: 0,
    dirtyBlocking: false,
    dirtyFiles: 0,
    restartNeeded: false,
    installNeeded: false,
    migratePending: 0,
    active: true,
    blockedReason: null,
    ...overrides,
  }
}

function job(overrides: Partial<DevHostJob> = {}): DevHostJob {
  return {
    id: 'job-1',
    action: 'update',
    state: 'running',
    step: 'restart-control-plane',
    steps: [
      'fetch',
      'pull',
      'install',
      'migrate',
      'restart-control-plane',
      'restart-web',
      'restart-daemon',
    ].map((name) => ({ name, state: 'pending', detail: null })),
    startedAt: '2026-11-03T11:59:00Z',
    endedAt: null,
    logTail: [],
    ...overrides,
  }
}

describe('parseDevHostStatus', () => {
  it('reads the daemon status shape', () => {
    const status = parseDevHostStatus(
      JSON.stringify({
        parts: [
          rawPart({
            behindBy: 3,
            dirty: { files: 2, blocking: true, kinds: [{ path: 'a', kind: 'content' }] },
            restartNeeded: true,
            setupNeeded: { install: true, migrate: { pending: 2 } },
            blockedReason: 'local changes',
          }),
        ],
        lastFetchAt: '2026-11-03T11:50:00Z',
        writtenAt: '2026-11-03T11:59:30Z',
        job: {
          id: 'job-1',
          action: 'update',
          state: 'failed',
          step: 'migrate',
          steps: [{ name: 'migrate', state: 'failed', detail: 'backup failed' }, 'junk', {}],
          startedAt: '2026-11-03T11:58:00Z',
          endedAt: '2026-11-03T11:59:00Z',
          logTail: ['line one', 7, 'line two'],
        },
      })
    )
    expect(status?.parts).toEqual([
      part({
        behindBy: 3,
        dirtyBlocking: true,
        dirtyFiles: 2,
        restartNeeded: true,
        installNeeded: true,
        migratePending: 2,
        blockedReason: 'local changes',
      }),
    ])
    expect(status?.lastFetchAt).toBe('2026-11-03T11:50:00Z')
    expect(status?.writtenAt).toBe('2026-11-03T11:59:30Z')
    expect(status?.job).toEqual({
      id: 'job-1',
      action: 'update',
      state: 'failed',
      step: 'migrate',
      steps: [{ name: 'migrate', state: 'failed', detail: 'backup failed' }],
      startedAt: '2026-11-03T11:58:00Z',
      endedAt: '2026-11-03T11:59:00Z',
      logTail: ['line one', 'line two'],
    })
  })

  it('returns null for bad JSON or a non-object', () => {
    expect(parseDevHostStatus('{not json')).toBeNull()
    expect(parseDevHostStatus('null')).toBeNull()
    expect(parseDevHostStatus('[1,2]')).toBeNull()
    expect(parseDevHostStatus('"text"')).toBeNull()
  })

  it('drops unknown part names and defaults missing or wrong-typed fields', () => {
    const status = parseDevHostStatus(
      JSON.stringify({
        parts: [
          { name: 'mailer' },
          'junk',
          { name: 'website', behindBy: -4, dirty: 'x', setupNeeded: { migrate: 'x' } },
          { name: 'daemon', behindBy: 2.7, setupNeeded: { migrate: { pending: Infinity } } },
        ],
        job: { action: 'update' },
      })
    )
    expect(status).toEqual({
      parts: [
        part({
          name: 'website',
          unit: '',
          branch: '',
          onTrunk: false,
          headCommit: '',
          active: false,
        }),
        part({
          name: 'daemon',
          unit: '',
          branch: '',
          onTrunk: false,
          headCommit: '',
          behindBy: 2,
          active: false,
        }),
      ],
      job: null,
      lastFetchAt: null,
      writtenAt: null,
    })
  })

  it('keeps a job with unknown enums and missing lists as it is', () => {
    const status = parseDevHostStatus(
      JSON.stringify({ parts: 'x', job: { id: 'j', action: 'rebuild', state: 'queued' } })
    )
    expect(status?.parts).toEqual([])
    expect(status?.job).toEqual({
      id: 'j',
      action: 'rebuild',
      state: 'queued',
      step: '',
      steps: [],
      startedAt: null,
      endedAt: null,
      logTail: [],
    })
  })
})

describe('readDevHostStatus', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('points at the daemon state folder', () => {
    expect(DEV_HOST_STATUS_PATH).toBe('/var/lib/turbopanel/dev-updates/status.json')
  })

  it('reads and parses the file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dev-host-status-'))
    const path = join(dir, 'status.json')
    writeFileSync(path, JSON.stringify({ parts: [rawPart()], job: null }))
    const status = await readDevHostStatus(path)
    expect(status?.parts).toHaveLength(1)
  })

  it('returns null for a missing file or bad content', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dev-host-status-'))
    await expect(readDevHostStatus(join(dir, 'missing.json'))).resolves.toBeNull()
    const path = join(dir, 'status.json')
    writeFileSync(path, '{"parts": [')
    await expect(readDevHostStatus(path)).resolves.toBeNull()
  })
})

describe('isDevHostStatusStale', () => {
  const status = { parts: [], job: null, lastFetchAt: null }

  it('is fresh within the window and stale after it or without a time', () => {
    const recent = new Date(NOW - 10_000).toISOString()
    const old = new Date(NOW - DEV_HOST_STALE_MS - 1).toISOString()
    expect(isDevHostStatusStale({ ...status, writtenAt: recent }, NOW)).toBe(false)
    expect(isDevHostStatusStale({ ...status, writtenAt: old }, NOW)).toBe(true)
    expect(isDevHostStatusStale({ ...status, writtenAt: null }, NOW)).toBe(true)
    expect(isDevHostStatusStale({ ...status, writtenAt: 'yesterday' }, NOW)).toBe(true)
  })
})

describe('devHostRowSuffix', () => {
  it('is empty when nothing needs doing or the checkout is missing', () => {
    expect(devHostRowSuffix(null)).toBe('')
    expect(devHostRowSuffix(part())).toBe('')
    expect(devHostRowSuffix(part({ headCommit: '', behindBy: 3 }))).toBe('')
  })

  it('lists everything a part needs, in order', () => {
    expect(
      devHostRowSuffix(
        part({
          behindBy: 3,
          restartNeeded: true,
          installNeeded: true,
          migratePending: 1,
          dirtyBlocking: true,
        })
      )
    ).toBe('↓3 · restart · install · migrate 1 · local changes')
  })

  it('names another branch or a detached head instead of the commit count', () => {
    expect(devHostRowSuffix(part({ onTrunk: false, branch: 'fix-x', behindBy: 5 }))).toBe(
      'on branch fix-x'
    )
    expect(
      devHostRowSuffix(part({ onTrunk: false, branch: '', behindBy: 5, restartNeeded: true }))
    ).toBe('detached head · restart')
  })

  it('says a behind checkout will not pull when the fast-forward was refused', () => {
    expect(
      devHostRowSuffix(part({ behindBy: 2, blockedReason: 'Not possible to fast-forward' }))
    ).toBe('↓2 · will not pull')
    expect(devHostRowSuffix(part({ behindBy: 0, blockedReason: 'stale reason' }))).toBe('')
  })
})

describe('devHostRowSuffixes', () => {
  const fresh = new Date(NOW - 1_000).toISOString()

  it('maps Services row ids to their parts', () => {
    const status = {
      parts: [
        part({ name: 'daemon', restartNeeded: true }),
        part({ name: 'control-plane', behindBy: 2 }),
        part({ name: 'web-interface', installNeeded: true }),
        part({ name: 'website' }),
      ],
      job: null,
      lastFetchAt: null,
      writtenAt: fresh,
    }
    const suffixes = devHostRowSuffixes(
      status,
      ['instance', 'daemon', 'caddy', 'ui', 'website', 'db'],
      NOW
    )
    expect([...suffixes]).toEqual([
      ['instance', '↓2'],
      ['daemon', 'restart'],
      ['ui', 'install'],
    ])
    expect(devHostPartForService(status, 'caddy')).toBeNull()
    expect(devHostPartForService(null, 'daemon')).toBeNull()
    expect(devHostPartForService({ ...status, parts: [] }, 'daemon')).toBeNull()
  })

  it('shows nothing without a status or when it is stale', () => {
    expect(devHostRowSuffixes(null, ['daemon'], NOW).size).toBe(0)
    const stale = {
      parts: [part({ name: 'daemon', restartNeeded: true })],
      job: null,
      lastFetchAt: null,
      writtenAt: new Date(NOW - DEV_HOST_STALE_MS - 1).toISOString(),
    }
    expect(devHostRowSuffixes(stale, ['daemon'], NOW).size).toBe(0)
  })
})

describe('devHostJobLine', () => {
  it('names the running step in plain words with its position', () => {
    expect(devHostJobLine(job(), NOW)).toEqual({
      text: 'Update and Restart: restarting the control plane (step 5 of 7)',
      failed: false,
    })
    expect(devHostJobLine(job({ action: 'restart', step: 'next-thing' }), NOW)).toEqual({
      text: 'Restart Only: next-thing',
      failed: false,
    })
    expect(devHostJobLine(job({ action: 'odd', step: '' }), NOW)?.text).toBe(
      'Development host job: starting'
    )
  })

  it('shows a failed job with its reason for a while after it ended', () => {
    const endedAt = new Date(NOW - 60_000).toISOString()
    const failed = job({
      state: 'failed',
      step: 'migrate',
      endedAt,
      steps: [{ name: 'migrate', state: 'failed', detail: 'backup failed' }],
    })
    expect(devHostJobLine(failed, NOW)).toEqual({
      text: 'Update and Restart failed while migrating the database: backup failed',
      failed: true,
    })
    const fromLog = job({ state: 'failed', step: 'pull', endedAt, logTail: ['a', 'fatal: x', ' '] })
    expect(devHostJobLine(fromLog, NOW)?.text).toBe(
      'Update and Restart failed while pulling the checkouts: fatal: x'
    )
    const bare = job({ state: 'failed', step: 'fetch', endedAt })
    expect(devHostJobLine(bare, NOW)?.text).toBe('Update and Restart failed while fetching trunk')
  })

  it('hides an old failure, a failure without an end time, a done job and no job', () => {
    const old = new Date(NOW - DEV_HOST_FAILED_VISIBLE_MS - 1).toISOString()
    expect(devHostJobLine(job({ state: 'failed', endedAt: old }), NOW)).toBeNull()
    expect(devHostJobLine(job({ state: 'failed', endedAt: null }), NOW)).toBeNull()
    expect(devHostJobLine(job({ state: 'done' }), NOW)).toBeNull()
    expect(devHostJobLine(null, NOW)).toBeNull()
  })
})

describe('labels and running state', () => {
  it('labels every step the daemon runs', () => {
    expect(devHostStepLabel('install')).toBe('installing packages')
    expect(devHostStepLabel('restart-web')).toBe('restarting the web interface and website')
    expect(devHostStepLabel('restart-daemon')).toBe('restarting the daemon')
    expect(devHostActionLabel('update')).toBe('Update and Restart')
  })

  it('knows when a job runs', () => {
    const status = { parts: [], job: job(), lastFetchAt: null, writtenAt: null }
    expect(isDevHostJobRunning(status)).toBe(true)
    expect(isDevHostJobRunning({ ...status, job: job({ state: 'done' }) })).toBe(false)
    expect(isDevHostJobRunning({ ...status, job: null })).toBe(false)
    expect(isDevHostJobRunning(null)).toBe(false)
  })
})

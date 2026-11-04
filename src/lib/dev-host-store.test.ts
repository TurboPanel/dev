import { describe, expect, it, vi } from 'vitest'
import type { DevHostStatus } from './dev-host-status.ts'
import { DEV_HOST_STALE_MS } from './dev-host-status.ts'
import {
  DEV_HOST_EXPECT_JOB_MS,
  DEV_HOST_FAST_POLL_MS,
  DEV_HOST_POLL_MS,
  DevHostStatusStore,
  devHostStatusStore,
} from './dev-host-store.ts'
import { readDevHostStatus } from './dev-host-status.ts'

// The shared store's default reader must never touch the real state folder.
vi.mock('./dev-host-status.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dev-host-status.ts')>()),
  readDevHostStatus: vi.fn(async () => null),
}))

function status(jobState: string | null = null): DevHostStatus {
  return {
    parts: [],
    lastFetchAt: null,
    writtenAt: '2026-11-03T12:00:00Z',
    job: jobState
      ? {
          id: 'job-1',
          action: 'update',
          state: jobState,
          step: 'fetch',
          steps: [],
          startedAt: null,
          endedAt: null,
          logTail: [],
        }
      : null,
  }
}

type Timer = { fn: () => void; ms: number; cleared: boolean }

function harness(reads: Array<DevHostStatus | null | Error>) {
  const timers: Timer[] = []
  let now = Date.parse('2026-11-03T12:00:10Z')
  const read = vi.fn(async () => {
    const next = reads.length > 1 ? reads.shift() : reads[0]
    if (next instanceof Error) throw next
    return next ?? null
  })
  const store = new DevHostStatusStore({
    read,
    now: () => now,
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (handle) => {
      ;(handle as Timer).cleared = true
    },
  })
  return {
    store,
    read,
    timers,
    live: () => timers.filter((timer) => !timer.cleared),
    /** Fire the one pending timer, as the clock would. */
    fire: () => {
      const timer = timers.find((entry) => !entry.cleared)
      if (!timer) throw new TypeError('no pending timer')
      timer.cleared = true
      timer.fn()
    },
    advance: (ms: number) => {
      now += ms
    },
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe('DevHostStatusStore', () => {
  it('reads on the first subscriber and polls at the usual pace', async () => {
    const h = harness([status()])
    const listener = vi.fn()
    h.store.subscribe(listener)
    await settle()
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(h.store.getSnapshot()).toEqual(status())
    expect(listener).toHaveBeenCalledTimes(1)
    expect(h.live().map((timer) => timer.ms)).toEqual([DEV_HOST_POLL_MS])
  })

  it('does not notify when the file did not change', async () => {
    const h = harness([status()])
    const listener = vi.fn()
    h.store.subscribe(listener)
    await settle()
    h.fire()
    await settle()
    expect(h.read).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('polls fast while a job runs and slows down once it ends', async () => {
    const h = harness([status('running'), status('done')])
    h.store.subscribe(() => undefined)
    await settle()
    expect(h.live().map((timer) => timer.ms)).toEqual([DEV_HOST_FAST_POLL_MS])
    h.fire()
    await settle()
    expect(h.store.getSnapshot()?.job?.state).toBe('done')
    expect(h.live().map((timer) => timer.ms)).toEqual([DEV_HOST_POLL_MS])
  })

  it('polls fast for a while after a job was started, before the file shows it', async () => {
    const h = harness([status()])
    h.store.subscribe(() => undefined)
    await settle()
    h.store.expectJob()
    await settle()
    expect(h.live().map((timer) => timer.ms)).toEqual([DEV_HOST_FAST_POLL_MS])
    h.advance(DEV_HOST_EXPECT_JOB_MS + 1)
    h.fire()
    await settle()
    expect(h.live().map((timer) => timer.ms)).toEqual([DEV_HOST_POLL_MS])
  })

  it('treats a failed read as no status', async () => {
    const h = harness([status(), new Error('EACCES')])
    const listener = vi.fn()
    h.store.subscribe(listener)
    await settle()
    await h.store.refresh()
    expect(h.store.getSnapshot()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('runs one more read when asked during a read, and never two at once', async () => {
    const h = harness([status()])
    h.store.subscribe(() => undefined)
    const second = h.store.refresh()
    await second
    await settle()
    expect(h.read).toHaveBeenCalledTimes(2)
    expect(h.live()).toHaveLength(1)
  })

  it('stops polling when the last subscriber leaves', async () => {
    const h = harness([status()])
    const unsubscribeA = h.store.subscribe(() => undefined)
    const unsubscribeB = h.store.subscribe(() => undefined)
    await settle()
    expect(h.read).toHaveBeenCalledTimes(1)
    unsubscribeA()
    expect(h.live()).toHaveLength(1)
    unsubscribeB()
    expect(h.live()).toHaveLength(0)
    await h.store.refresh()
    expect(h.live()).toHaveLength(0)
  })

  it('exports one shared store that reads through the status reader', async () => {
    expect(devHostStatusStore.getSnapshot()).toBeNull()
    const unsubscribe = devHostStatusStore.subscribe(() => undefined)
    await settle()
    expect(readDevHostStatus).toHaveBeenCalledWith()
    devHostStatusStore.expectJob()
    await settle()
    unsubscribe()
  })
})

describe('DevHostStatusStore staleness', () => {
  it('notifies once when an unchanged file turns stale and drops back to the slow poll', async () => {
    const h = harness([status('running')])
    const listener = vi.fn()
    h.store.subscribe(listener)
    await settle()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(h.live().map((timer) => timer.ms)).toEqual([DEV_HOST_FAST_POLL_MS])
    const before = h.store.getSnapshot()
    h.advance(DEV_HOST_STALE_MS + 1_000)
    h.fire()
    await settle()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(h.store.getSnapshot()).not.toBe(before)
    expect(h.store.getSnapshot()).toEqual(before)
    expect(h.live().map((timer) => timer.ms)).toEqual([DEV_HOST_POLL_MS])
    h.fire()
    await settle()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import type { DevHostStatus } from '../lib/dev-host-status.ts'
import { DevHostStatusStore } from '../lib/dev-host-store.ts'
import { mountHook, type MountedHook } from './ink-hook-render.ts'
import { useDevHostStatus } from './use-dev-host-status.ts'

const STATUS: DevHostStatus = {
  parts: [],
  job: null,
  lastFetchAt: null,
  writtenAt: '2026-11-03T12:00:00Z',
}

describe('useDevHostStatus', () => {
  let mounted: MountedHook<DevHostStatus | null> | undefined

  afterEach(() => {
    mounted?.unmount()
    mounted = undefined
  })

  it('renders null first, then the status the store read', async () => {
    const store = new DevHostStatusStore({
      read: async () => STATUS,
      // Never the real control plane socket from a test.
      readMigrate: async () => null,
      now: () => Date.parse(STATUS.writtenAt!),
      setTimer: () => null,
      clearTimer: () => undefined,
    })
    mounted = mountHook(() => useDevHostStatus(store))
    expect(mounted.get()).toBeNull()
    // Wait for the condition, not for a fixed time: flush until it lands.
    for (let attempt = 0; attempt < 100 && mounted.get() === null; attempt += 1) {
      await mounted.flush()
    }
    expect(mounted.get()).toEqual(STATUS)
  })
})

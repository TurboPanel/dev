import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountHook, type MountedHook } from './ink-hook-render.ts'
import { STARTED_NOTE_TTL_MS, useStartedNote } from './use-started-note.ts'

type Hook = ReturnType<typeof useStartedNote>

describe('useStartedNote', () => {
  let mounted: MountedHook<Hook> | undefined

  afterEach(() => {
    mounted?.unmount()
    mounted = undefined
    vi.useRealTimers()
  })

  it('clears the note once a job line is present', async () => {
    const state = { job: false }
    mounted = mountHook(() => useStartedNote(state.job))
    await mounted.flush()
    mounted.get()[1]('Started Restart Only…')
    await mounted.flush()
    expect(mounted.get()[0]).toBe('Started Restart Only…')

    state.job = true
    mounted.rerender()
    await mounted.flush()
    expect(mounted.get()[0]).toBeNull()

    // The job ends: the note does not come back.
    state.job = false
    mounted.rerender()
    await mounted.flush()
    expect(mounted.get()[0]).toBeNull()
  })

  it('clears a note set while a job line already shows', async () => {
    mounted = mountHook(() => useStartedNote(true))
    await mounted.flush()
    mounted.get()[1]('Started Update and Restart…')
    await mounted.flush()
    await mounted.flush()
    expect(mounted.get()[0]).toBeNull()
  })

  it('clears the note after the time limit when no job line shows', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mounted = mountHook(() => useStartedNote(false))
    await mounted.flush()
    mounted.get()[1]('Started Restart Only…')
    await mounted.flush()

    await vi.advanceTimersByTimeAsync(STARTED_NOTE_TTL_MS - 1)
    await mounted.flush()
    expect(mounted.get()[0]).toBe('Started Restart Only…')

    await vi.advanceTimersByTimeAsync(1)
    await mounted.flush()
    expect(mounted.get()[0]).toBeNull()
  })
})

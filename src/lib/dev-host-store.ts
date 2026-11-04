import {
  type DevHostStatus,
  devHostViewKey,
  isDevHostJobRunning,
  readDevHostStatus,
} from './dev-host-status.ts'

/** The usual re-read, the same pace as the Services rows. */
export const DEV_HOST_POLL_MS = 15_000
/** While a job runs (or was just started), so progress moves on screen. */
export const DEV_HOST_FAST_POLL_MS = 2_000
/** After starting a job, poll fast this long even before the file shows it. */
export const DEV_HOST_EXPECT_JOB_MS = 30_000

export type DevHostStoreDeps = {
  read: () => Promise<DevHostStatus | null>
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

const defaultDeps: DevHostStoreDeps = {
  read: () => readDevHostStatus(),
  now: Date.now,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/**
 * Shared reader of the daemon's development host status file.
 *
 * It reads one small file (no subprocess) only while something on screen
 * subscribes: every {@link DEV_HOST_POLL_MS}, and every
 * {@link DEV_HOST_FAST_POLL_MS} while a fresh file shows a running job.
 * Listeners hear only changes to what the screen shows (content, staleness,
 * job line), so an unchanged file repaints Ink only when it turns stale.
 */
export class DevHostStatusStore {
  readonly #deps: DevHostStoreDeps
  readonly #listeners = new Set<() => void>()
  #status: DevHostStatus | null = null
  #key = 'null'
  #timer: unknown = null
  #busy = false
  #pending = false
  #expectJobUntil = 0

  constructor(deps: Partial<DevHostStoreDeps> = {}) {
    this.#deps = { ...defaultDeps, ...deps }
  }

  readonly getSnapshot = (): DevHostStatus | null => this.#status

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    if (this.#listeners.size === 1) void this.refresh()
    return () => {
      this.#listeners.delete(listener)
      if (this.#listeners.size === 0) this.#stopTimer()
    }
  }

  /** A job was just started: read now and keep polling fast for a while. */
  expectJob(): void {
    this.#expectJobUntil = this.#deps.now() + DEV_HOST_EXPECT_JOB_MS
    void this.refresh()
  }

  /** Read the file now; a call during a read runs once more after it. */
  async refresh(): Promise<void> {
    if (this.#busy) {
      this.#pending = true
      return
    }
    this.#busy = true
    this.#stopTimer()
    try {
      this.#apply(await this.#deps.read().catch(() => null))
    } finally {
      this.#busy = false
    }
    if (this.#pending) {
      this.#pending = false
      await this.refresh()
      return
    }
    this.#schedule()
  }

  #apply(next: DevHostStatus | null): void {
    // The key includes staleness and job-line visibility at this moment, so a
    // file that stopped changing still repaints once when it turns stale.
    const key = devHostViewKey(next, this.#deps.now())
    if (key === this.#key) return
    this.#key = key
    // A fresh object even for the same content: useSyncExternalStore only
    // re-renders when the snapshot reference changes.
    this.#status = next ? { ...next } : null
    for (const listener of this.#listeners) listener()
  }

  #schedule(): void {
    if (this.#listeners.size === 0) return
    const now = this.#deps.now()
    const fast = isDevHostJobRunning(this.#status, now) || now < this.#expectJobUntil
    this.#timer = this.#deps.setTimer(
      () => {
        this.#timer = null
        void this.refresh()
      },
      fast ? DEV_HOST_FAST_POLL_MS : DEV_HOST_POLL_MS
    )
  }

  #stopTimer(): void {
    if (this.#timer !== null) {
      this.#deps.clearTimer(this.#timer)
      this.#timer = null
    }
  }
}

/** The one store the console uses. */
export const devHostStatusStore = new DevHostStatusStore()

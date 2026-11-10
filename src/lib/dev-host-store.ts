import { getDevHostMigrate } from './developer-client.ts'
import {
  DEV_HOST_STALE_MS,
  type DevHostMigrate,
  type DevHostStatus,
  devHostViewKey,
  isDevHostJobRunning,
  readDevHostStatus,
  withDevHostMigrate,
} from './dev-host-status.ts'

/** The usual re-read, the same pace as the Services rows. */
export const DEV_HOST_POLL_MS = 15_000
/** While a job runs (or was just started), so progress moves on screen. */
export const DEV_HOST_FAST_POLL_MS = 2_000
/** After starting a job, poll fast this long even before the file shows it. */
export const DEV_HOST_EXPECT_JOB_MS = 30_000
/**
 * The control plane's migration counts are asked for at most this often (its
 * own answer is cached as long), and again as soon as a job ends.
 */
export const DEV_HOST_MIGRATE_POLL_MS = 30_000

export type DevHostStoreDeps = {
  read: () => Promise<DevHostStatus | null>
  readMigrate: () => Promise<DevHostMigrate | null>
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

const defaultDeps: DevHostStoreDeps = {
  read: () => readDevHostStatus(),
  readMigrate: () => getDevHostMigrate(),
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
 *
 * The database counts come from the control plane (one signed request over
 * its socket, at most every {@link DEV_HOST_MIGRATE_POLL_MS}, only while the
 * file is there). That read runs beside the file read and never holds it up:
 * the file keeps moving while the control plane restarts. A failed read keeps
 * the last counts until they are {@link DEV_HOST_STALE_MS} old.
 */
export class DevHostStatusStore {
  readonly #deps: DevHostStoreDeps
  readonly #listeners = new Set<() => void>()
  #status: DevHostStatus | null = null
  #file: DevHostStatus | null = null
  #key = 'null'
  #migrate: DevHostMigrate | null = null
  #migrateAt = 0
  #migrateTriedAt: number | null = null
  #migrateBusy = false
  #jobRunning = false
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
      this.#file = await this.#deps.read().catch(() => null)
      this.#apply()
      this.#maybeReadMigrate()
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

  #maybeReadMigrate(): void {
    const now = this.#deps.now()
    const running = isDevHostJobRunning(this.#file, now)
    // A job that just ended may have migrated: ask again now.
    if (this.#jobRunning && !running) this.#migrateTriedAt = null
    this.#jobRunning = running
    if (this.#migrateBusy || !this.#file) return
    if (this.#migrateTriedAt !== null && now - this.#migrateTriedAt < DEV_HOST_MIGRATE_POLL_MS) {
      return
    }
    this.#migrateBusy = true
    this.#migrateTriedAt = now
    void this.#deps
      .readMigrate()
      .then(
        (migrate) => {
          this.#migrate = migrate
          this.#migrateAt = this.#deps.now()
        },
        () => undefined
      )
      .finally(() => {
        this.#migrateBusy = false
        this.#apply()
      })
  }

  #apply(): void {
    const fresh = this.#deps.now() - this.#migrateAt <= DEV_HOST_STALE_MS
    const migrate = fresh ? this.#migrate : null
    const next = this.#file ? withDevHostMigrate(this.#file, migrate) : null
    // The key includes staleness and job-line visibility at this moment, so a
    // file that stopped changing still repaints once when it turns stale.
    const key = devHostViewKey(next, this.#deps.now())
    if (key === this.#key) return
    this.#key = key
    // A fresh object even for the same content: useSyncExternalStore only
    // re-renders when the snapshot reference changes.
    this.#status = next
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

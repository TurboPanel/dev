import { readFile } from 'node:fs/promises'
import { STATE_DIR } from './paths.ts'

/**
 * The development host status the co-located daemon writes for this console.
 *
 * The daemon (`turbopaneld/src/dev-host/`) writes the whole status atomically
 * to `<state>/dev-updates/status.json` on every change and at least once a
 * minute, plus `writtenAt`. The console only reads the file: it keeps working
 * while the control plane restarts, and it never runs git, pnpm or systemctl
 * for these parts. Every field is read leniently: a missing file, bad JSON or
 * an unknown value gives `null` or a safe default, never a throw.
 */
export const DEV_HOST_STATUS_PATH = `${STATE_DIR}/dev-updates/status.json`

/** Older than this, the daemon has stopped writing: row suffixes are hidden. */
export const DEV_HOST_STALE_MS = 3 * 60_000
/** A failed job stays on screen this long after it ended. */
export const DEV_HOST_FAILED_VISIBLE_MS = 15 * 60_000

export type DevHostPartName = 'daemon' | 'control-plane' | 'web-interface' | 'website'

export type DevHostPart = {
  name: DevHostPartName
  unit: string
  branch: string
  onTrunk: boolean
  headCommit: string
  behindBy: number
  dirtyBlocking: boolean
  dirtyFiles: number
  restartNeeded: boolean
  installNeeded: boolean
  migratePending: number
  active: boolean
  blockedReason: string | null
}

export type DevHostJobStep = { name: string; state: string; detail: string | null }

export type DevHostJob = {
  id: string
  /** `update`, `restart`, or whatever a newer daemon sends. */
  action: string
  /** `running`, `done`, `failed`, or whatever a newer daemon sends. */
  state: string
  step: string
  steps: DevHostJobStep[]
  startedAt: string | null
  endedAt: string | null
  logTail: string[]
}

/**
 * The database's migration counts, from the control plane's development view
 * (`GET /api/developer/v1/dev-host/status`, `host.migrate`), the same numbers
 * the web interface's Development Host bar shows. The daemon cannot read the
 * database, so `status.json` never carries them.
 */
export type DevHostMigrate = {
  /** Migrations in the control plane checkout the database has not applied. */
  pending: number
  /** Migrations the database has applied. */
  applied: number
  /** Migrations trunk ships. */
  total: number
}

export type DevHostStatus = {
  parts: DevHostPart[]
  job: DevHostJob | null
  lastFetchAt: string | null
  writtenAt: string | null
  /** Added by the store from the control plane; absent in the file. */
  migrate?: DevHostMigrate | null
}

const PART_NAMES: ReadonlySet<string> = new Set([
  'daemon',
  'control-plane',
  'web-interface',
  'website',
])

/** Services row id → development host part. */
const SERVICE_PARTS: Readonly<Record<string, DevHostPartName>> = {
  daemon: 'daemon',
  instance: 'control-plane',
  ui: 'web-interface',
  website: 'website',
}

const STEP_LABELS: Readonly<Record<string, string>> = {
  fetch: 'fetching trunk',
  pull: 'pulling the checkouts',
  install: 'installing packages',
  migrate: 'migrating the database',
  'restart-control-plane': 'restarting the control plane',
  'restart-web': 'restarting the web interface and website',
  'restart-daemon': 'restarting the daemon',
}

const ACTION_LABELS: Readonly<Record<string, string>> = {
  update: 'Update and Restart',
  restart: 'Restart Only',
}

type Json = Record<string, unknown>

function asObject(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : null
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * The `migrate` block of a development view; null unless both `applied` and
 * `total` are whole numbers (the bar's rule for showing the database line).
 */
export function parseDevHostMigrate(value: unknown): DevHostMigrate | null {
  const raw = asObject(value)
  const applied = wholeNumber(raw?.applied)
  const total = wholeNumber(raw?.total)
  if (applied === null || total === null) return null
  return { pending: count(raw?.pending), applied, total }
}

/**
 * The status with the control plane's counts added: `migrate`, and the
 * control plane part's `migratePending` raised to the control plane's pending
 * count (the bar counts it the same way).
 */
export function withDevHostMigrate(
  status: DevHostStatus,
  migrate: DevHostMigrate | null
): DevHostStatus {
  if (!migrate) return { ...status, migrate: undefined }
  const parts = status.parts.map((part) =>
    part.name === 'control-plane' && migrate.pending > part.migratePending
      ? { ...part, migratePending: migrate.pending }
      : part
  )
  return { ...status, parts, migrate }
}

function parsePart(value: unknown): DevHostPart | null {
  const raw = asObject(value)
  const name = raw?.name
  if (!raw || typeof name !== 'string' || !PART_NAMES.has(name)) return null
  const dirty = asObject(raw.dirty)
  const setup = asObject(raw.setupNeeded)
  return {
    name: name as DevHostPartName,
    unit: str(raw.unit),
    branch: str(raw.branch),
    onTrunk: raw.onTrunk === true,
    headCommit: str(raw.headCommit),
    behindBy: count(raw.behindBy),
    dirtyBlocking: dirty?.blocking === true,
    dirtyFiles: count(dirty?.files),
    restartNeeded: raw.restartNeeded === true,
    installNeeded: setup?.install === true,
    migratePending: count(asObject(setup?.migrate)?.pending),
    active: raw.active === true,
    blockedReason: strOrNull(raw.blockedReason),
  }
}

function parseStep(value: unknown): DevHostJobStep | null {
  const raw = asObject(value)
  if (!raw || typeof raw.name !== 'string') return null
  return { name: raw.name, state: str(raw.state), detail: strOrNull(raw.detail) }
}

function parseJob(value: unknown): DevHostJob | null {
  const raw = asObject(value)
  if (!raw || typeof raw.id !== 'string') return null
  const steps = Array.isArray(raw.steps) ? raw.steps.map(parseStep) : []
  const logTail = Array.isArray(raw.logTail) ? raw.logTail : []
  return {
    id: raw.id,
    action: str(raw.action),
    state: str(raw.state),
    step: str(raw.step),
    steps: steps.filter((step): step is DevHostJobStep => step !== null),
    startedAt: strOrNull(raw.startedAt),
    endedAt: strOrNull(raw.endedAt),
    logTail: logTail.filter((line): line is string => typeof line === 'string'),
  }
}

/** Parse the text of `status.json`; `null` when it is not a status object. */
export function parseDevHostStatus(text: string): DevHostStatus | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const raw = asObject(parsed)
  if (!raw) return null
  const parts = Array.isArray(raw.parts) ? raw.parts.map(parsePart) : []
  return {
    parts: parts.filter((part): part is DevHostPart => part !== null),
    job: parseJob(raw.job),
    lastFetchAt: strOrNull(raw.lastFetchAt),
    writtenAt: strOrNull(raw.writtenAt),
  }
}

/** Read `status.json`; `null` when it is missing, unreadable or not a status. */
export async function readDevHostStatus(
  path: string = DEV_HOST_STATUS_PATH
): Promise<DevHostStatus | null> {
  try {
    return parseDevHostStatus(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

/** True when the daemon has not written the file for {@link DEV_HOST_STALE_MS}. */
export function isDevHostStatusStale(status: DevHostStatus, nowMs: number): boolean {
  const written = status.writtenAt ? Date.parse(status.writtenAt) : Number.NaN
  return Number.isNaN(written) || nowMs - written > DEV_HOST_STALE_MS
}

export function devHostPartForService(
  status: DevHostStatus | null,
  serviceId: string
): DevHostPart | null {
  const name = SERVICE_PARTS[serviceId]
  if (!status || !name) return null
  return status.parts.find((part) => part.name === name) ?? null
}

function branchNote(part: DevHostPart): string {
  return part.branch ? `on branch ${part.branch}` : 'detached head'
}

/**
 * The short note after a Services row, only when the part needs something,
 * e.g. `↓3 · restart · install · local changes` or `on branch fix-x · restart`.
 * `migrate N` comes from the control plane's counts (the daemon's
 * `status.json` has none). Empty when nothing needs doing.
 */
export function devHostRowSuffix(part: DevHostPart | null): string {
  if (!part?.headCommit) return ''
  const notes: string[] = []
  if (!part.onTrunk) notes.push(branchNote(part))
  else if (part.behindBy > 0) notes.push(`↓${part.behindBy}`)
  if (part.restartNeeded) notes.push('restart')
  if (part.installNeeded) notes.push('install')
  if (part.migratePending > 0) notes.push(`migrate ${part.migratePending}`)
  if (part.dirtyBlocking) notes.push('local changes')
  else if (part.onTrunk && part.behindBy > 0 && part.blockedReason) notes.push('will not pull')
  return notes.join(' · ')
}

/** Row suffix per Services row id, from a fresh status only. */
export function devHostRowSuffixes(
  status: DevHostStatus | null,
  serviceIds: readonly string[],
  nowMs: number
): Map<string, string> {
  const suffixes = new Map<string, string>()
  if (!status || isDevHostStatusStale(status, nowMs)) return suffixes
  for (const id of serviceIds) {
    const suffix = devHostRowSuffix(devHostPartForService(status, id))
    if (suffix) suffixes.set(id, suffix)
  }
  return suffixes
}

const PART_LABELS: Readonly<Record<DevHostPartName, string>> = {
  'control-plane': 'Control Plane',
  'web-interface': 'Web Interface',
  website: 'Website',
  daemon: 'Daemon',
}

function plural(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`
}

function partNeedsWork(part: DevHostPart): boolean {
  return (
    part.behindBy > 0 ||
    part.restartNeeded ||
    part.installNeeded ||
    part.migratePending > 0 ||
    part.dirtyBlocking
  )
}

/**
 * The daemon's reason in its own words, ending "will not pull": a trailing
 * "; not pulled" and full stops are dropped. Null when it gave none.
 */
function blockedFragment(reason: string | null): string | null {
  let text = reason?.trim() ?? ''
  const suffix = 'not pulled'
  if (text.endsWith(suffix)) {
    const head = text.slice(0, -suffix.length).trimEnd()
    if (head.endsWith(';')) text = head.slice(0, -1)
  }
  while (text.endsWith('.')) text = text.slice(0, -1)
  return text === '' ? null : `${text}, will not pull`
}

function stateFragment(part: DevHostPart): string | null {
  const behind = part.behindBy > 0
  if (behind && !part.onTrunk) return `on branch ${part.branch || 'unknown'}, will not pull`
  if (part.dirtyBlocking) return behind ? 'local changes, will not pull' : 'local changes'
  if (behind) return `${plural(part.behindBy, 'new commit', 'new commits')} on trunk`
  return null
}

/**
 * One line for a part that needs something, in the same words as the web
 * interface's Development Host bar: "Control Plane: 3 new commits on trunk, 1
 * migration pending", "Control Plane: detached at 4f7b5ed, 19 behind trunk,
 * will not pull", "Website: local changes in a.ts, will not pull". The
 * daemon's `blockedReason` is used when it sent one. Null when it needs
 * nothing.
 */
export function devHostPartLine(part: DevHostPart): string | null {
  if (!partNeedsWork(part)) return null
  const fragments: string[] = []
  const blocked = blockedFragment(part.blockedReason)
  if (blocked === null) {
    const state = stateFragment(part)
    if (state !== null) fragments.push(state)
  } else {
    fragments.push(blocked)
    if (part.behindBy > 0 && !blocked.includes('behind trunk')) {
      fragments.push(`${plural(part.behindBy, 'new commit', 'new commits')} on trunk`)
    }
  }
  if (part.installNeeded) fragments.push('packages to install')
  if (part.migratePending > 0) {
    fragments.push(`${plural(part.migratePending, 'migration', 'migrations')} pending`)
  }
  if (part.restartNeeded) fragments.push('restart needed')
  return `${PART_LABELS[part.name]}: ${fragments.join(', ')}`
}

/** "Database: 23 of 25 migrations applied" (the total is what trunk ships); null without counts. */
export function devHostDatabaseLine(migrate: DevHostMigrate | null | undefined): string | null {
  if (!migrate) return null
  return `Database: ${migrate.applied} of ${plural(migrate.total, 'migration', 'migrations')} applied`
}

/** One line above a Services row's detail; `database` marks the database line. */
export type DevHostDetailLine = { text: string; database: boolean }

/**
 * The full lines above a Services row's detail, from a fresh status only:
 * the part's line when it needs something and, on the control plane row, the
 * database line. Row notes are cut to fit the list; these take the detail
 * pane's width.
 */
export function devHostDetailLines(
  status: DevHostStatus | null,
  serviceId: string,
  nowMs: number
): DevHostDetailLine[] {
  if (!status || isDevHostStatusStale(status, nowMs)) return []
  const lines: DevHostDetailLine[] = []
  const part = devHostPartForService(status, serviceId)
  const partLine = part?.headCommit ? devHostPartLine(part) : null
  if (partLine !== null) lines.push({ text: partLine, database: false })
  if (SERVICE_PARTS[serviceId] === 'control-plane') {
    const database = devHostDatabaseLine(status.migrate)
    if (database !== null) lines.push({ text: database, database: true })
  }
  return lines
}

export function devHostStepLabel(step: string): string {
  return STEP_LABELS[step] ?? (step || 'starting')
}

export function devHostActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? 'Development host job'
}

function failedStepDetail(job: DevHostJob): string | null {
  const failed = job.steps.find((step) => step.state === 'failed')
  return failed?.detail ?? lastNonBlankLine(job.logTail)
}

function lastNonBlankLine(lines: readonly string[]): string | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]!.trim().length > 0) return lines[index]!
  }
  return null
}

export type DevHostJobLine = { text: string; failed: boolean }

/**
 * One line about the job while it runs or shortly after it failed, e.g.
 * `Update and Restart: restarting the control plane (step 5 of 7)`.
 * `null` when there is nothing to show.
 */
export function devHostJobLine(job: DevHostJob | null, nowMs: number): DevHostJobLine | null {
  if (!job) return null
  const action = devHostActionLabel(job.action)
  if (job.state === 'running') {
    const index = job.steps.findIndex((step) => step.name === job.step)
    const position = index >= 0 ? ` (step ${index + 1} of ${job.steps.length})` : ''
    return { text: `${action}: ${devHostStepLabel(job.step)}${position}`, failed: false }
  }
  if (job.state === 'failed') {
    const ended = job.endedAt ? Date.parse(job.endedAt) : Number.NaN
    if (Number.isNaN(ended) || nowMs - ended > DEV_HOST_FAILED_VISIBLE_MS) return null
    const detail = failedStepDetail(job)
    const head = `${action} failed while ${devHostStepLabel(job.step)}`
    return { text: detail ? `${head}: ${detail}` : head, failed: true }
  }
  return null
}

/**
 * True when a fresh status shows a running job. A stale file that still says
 * `running` (the daemon stopped writing mid-job) does not count, so actions
 * are not refused and polling does not stay fast forever.
 */
export function isDevHostJobRunning(status: DevHostStatus | null, nowMs: number): boolean {
  return status?.job?.state === 'running' && !isDevHostStatusStale(status, nowMs)
}

/** The job line for a whole status: a stale file's running job shows nothing. */
export function devHostStatusJobLine(
  status: DevHostStatus | null,
  nowMs: number
): DevHostJobLine | null {
  if (!status?.job) return null
  if (status.job.state === 'running' && !isDevHostJobRunning(status, nowMs)) return null
  return devHostJobLine(status.job, nowMs)
}

/**
 * What the screen shows from a status at `nowMs`: the content plus whether it
 * is stale and whether a job line shows. When any of these changes the store
 * notifies, so notes and lines also disappear when only the clock moved.
 */
export function devHostViewKey(status: DevHostStatus | null, nowMs: number): string {
  if (!status) return 'null'
  const stale = isDevHostStatusStale(status, nowMs)
  const line = devHostStatusJobLine(status, nowMs) !== null
  return `${stale ? 'stale' : 'fresh'}|${line ? 'line' : 'noline'}|${JSON.stringify(status)}`
}

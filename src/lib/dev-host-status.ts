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

export type DevHostStatus = {
  parts: DevHostPart[]
  job: DevHostJob | null
  lastFetchAt: string | null
  writtenAt: string | null
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
 * e.g. `↓3 · restart · install · migrate 1 · local changes` or
 * `on branch fix-x · restart`. Empty when nothing needs doing.
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

export function isDevHostJobRunning(status: DevHostStatus | null): boolean {
  return status?.job?.state === 'running'
}

import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Lines of stderr kept for the failure view. */
export const BOOTSTRAP_STDERR_TAIL_LINES = 20

const FAILURE_PREFIXES = ['✗', '[bootstrap]']

/** The message after a failure prefix, or null when the line has none. */
function failureText(line: string): string | null {
  for (const prefix of FAILURE_PREFIXES) {
    if (!line.startsWith(prefix)) continue
    const rest = line.slice(prefix.length)
    if (rest.trimStart() === rest) continue
    const text = rest.trim()
    if (text.length > 0) return text
  }
  return null
}

/**
 * Collects the daemon bootstrap's output so a failure shows what failed, not
 * just the last line printed. The daemon's installer writes `✗ <message>` to
 * stderr and then the last lines of the failing command (uv's package list,
 * for example) after it, so the last stderr line is rarely the error.
 */
export class BootstrapOutputCollector {
  readonly #all: string[] = []
  readonly #stderrTail: string[] = []
  #failure: string | null = null
  #lastStdout = ''

  add(stream: 'stdout' | 'stderr', line: string): void {
    const text = line.trimEnd()
    if (text.trim().length === 0) return
    this.#all.push(`${stream === 'stderr' ? 'err' : 'out'}| ${text}`)
    const trimmed = text.trim()
    if (stream === 'stdout') {
      this.#lastStdout = trimmed
      return
    }
    this.#stderrTail.push(trimmed)
    if (this.#stderrTail.length > BOOTSTRAP_STDERR_TAIL_LINES) {
      this.#stderrTail.shift()
    }
    const failure = failureText(trimmed)
    if (failure) this.#failure = failure
  }

  /** The daemon's own failure message, or the last line seen as a fallback. */
  failureMessage(): string {
    return (
      this.#failure ??
      this.#stderrTail.at(-1) ??
      (this.#lastStdout || 'Bootstrap orchestration failed')
    )
  }

  stderrTail(): string[] {
    return [...this.#stderrTail]
  }

  lines(): string[] {
    return [...this.#all]
  }
}

export function formatBootstrapFailure(opts: {
  failure: string
  code: number | null
  signal?: string | null
  logPath: string | null
}): string {
  const status = opts.code === null ? `signal ${opts.signal ?? 'unknown'}` : `exit ${opts.code}`
  const lines = [`Bootstrap failed (${status}): ${opts.failure}`]
  if (opts.logPath) lines.push(`Full output: ${opts.logPath}`)
  return lines.join('\n')
}

/**
 * Write the whole bootstrap output (overwritten each run). Falls back to the
 * temp folder when the console log folder cannot be written; returns the path
 * written, or null.
 */
export async function writeBootstrapLog(
  path: string,
  lines: string[],
  now: Date = new Date()
): Promise<string | null> {
  const body = [`time=${now.toISOString()}`, '', ...lines, ''].join('\n')
  for (const target of [path, join(tmpdir(), 'turbopanel-bootstrap-orchestration.log')]) {
    try {
      await fs.mkdir(dirname(target), { recursive: true })
      await fs.writeFile(target, body, { mode: 0o640 })
      return target
    } catch {
      // try the next place
    }
  }
  return null
}

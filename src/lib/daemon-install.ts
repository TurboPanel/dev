import { spawn } from 'node:child_process'
import { bootstrapOrchestrationCommand, ensureBootstrapDeno } from './daemon-exec.ts'
import {
  BootstrapOutputCollector,
  formatBootstrapFailure,
  writeBootstrapLog,
} from './bootstrap-failure.ts'
import {
  CONSOLE_BOOTSTRAP_LOG,
  daemonRepoPath,
  DAEMON_SYSTEMD_UNIT,
  PYTHON_RUNTIME_DIR,
  resolveDevRoot,
  UV_CACHE_DIR,
} from './paths.ts'
import type { InstallStepHandler } from './platform-install.ts'
import {
  captureChildEnv,
  type InstallOutputHandler,
  runCaptured,
  sanitizeInstallOutput,
} from './install-output.ts'
import { ensureFhsTreeOwnership } from './turbopanel-permissions.ts'
import { writeDaemonBaseEnv } from './daemon-env.ts'
import { resolveDevIdentity } from './dev-identity.ts'
import { TRUSTED_SYSTEM_PATH } from './spawn-trusted.ts'
import { shellQuote } from './shell-quote.ts'

/**
 * Dev vs production install path invariant:
 *
 * Dev path — uses `daemon-systemd-setup.yml` (source run mode, `deno run main.ts`).
 * Dev identity vars are written via `writeDaemonBaseEnv()` before
 * `install-daemon-systemd.sh`, which forwards them as Ansible extra-vars.
 *
 * Production path — `scripts/run.sh` runs `daemon-install.yml` against the
 * extracted source tree (source run mode, `deno run main.ts`). No dev identity
 * vars are written. Both paths run the daemon from source — there is no compiled
 * binary run mode.
 *
 * The dev stack runs entirely as the single invoking dev user. Bootstrap runs
 * directly as that user (Ansible's `become: true` handles per-task privilege
 * escalation via the dev user's own passwordless sudo).
 */
const DAEMON_DIR = daemonRepoPath()

function bootstrapEnv(): string[] {
  return [
    `UV_PYTHON_INSTALL_DIR=${PYTHON_RUNTIME_DIR}`,
    `UV_CACHE_DIR=${UV_CACHE_DIR}`,
    'UV_NO_MODIFY_PATH=1',
    'UV_PYTHON_DOWNLOADS=automatic',
    'UV_VENV_CLEAR=1',
    // Match daemon runtimeEnv(): cryptography 47+ SIGILLs on Apple Silicon VMs
    // that advertise SVE2 without implementing it (UTM). Harmless elsewhere.
    'OPENSSL_armcap=0',
  ]
}

async function prepareBootstrapEnvironment(onOutput?: InstallOutputHandler): Promise<void> {
  await ensureFhsTreeOwnership(onOutput)
}

export async function bootstrapOrchestration(
  onEvent: (event: unknown) => void,
  onOutput?: InstallOutputHandler
): Promise<void> {
  await prepareBootstrapEnvironment(onOutput)

  await ensureBootstrapDeno(onOutput)

  const bootstrapInvocation = bootstrapOrchestrationCommand()
  const command = `cd ${shellQuote(DAEMON_DIR)} && exec ${bootstrapInvocation}`

  await new Promise<void>((resolve, reject) => {
    const child = spawn('/usr/bin/env', [...bootstrapEnv(), '/bin/bash', '-c', command], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: captureChildEnv({ PATH: TRUSTED_SYSTEM_PATH }),
      detached: false,
    })

    let stdoutBuffer = ''
    let stderrBuffer = ''
    const collected = new BootstrapOutputCollector()

    const handleLine = (line: string) => {
      const trimmed = sanitizeInstallOutput(line).trim()
      if (trimmed.length === 0) return
      try {
        onEvent(JSON.parse(trimmed))
        return
      } catch {
        // not an event: plain output
      }
      collected.add('stdout', trimmed)
      onOutput?.(trimmed)
    }

    const handleStderrLine = (line: string) => {
      const clean = sanitizeInstallOutput(line)
      if (clean.trim().length === 0) return
      collected.add('stderr', clean)
      onOutput?.(clean.trim())
    }

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString()
      let newline = stdoutBuffer.indexOf('\n')
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline)
        stdoutBuffer = stdoutBuffer.slice(newline + 1)
        handleLine(line)
        newline = stdoutBuffer.indexOf('\n')
      }
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString()
      let newline = stderrBuffer.indexOf('\n')
      while (newline >= 0) {
        const line = stderrBuffer.slice(0, newline)
        stderrBuffer = stderrBuffer.slice(newline + 1)
        handleStderrLine(line)
        newline = stderrBuffer.indexOf('\n')
      }
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code, signal) => {
      if (stdoutBuffer.trim().length > 0) handleLine(stdoutBuffer)
      if (stderrBuffer.trim().length > 0) handleStderrLine(stderrBuffer)
      if (code === 0) {
        resolve()
        return
      }
      void writeBootstrapLog(CONSOLE_BOOTSTRAP_LOG, collected.lines()).then((logPath) => {
        reject(
          new Error(
            formatBootstrapFailure({
              failure: collected.failureMessage(),
              code,
              signal,
              logPath,
            })
          )
        )
      })
    })
  })
}

export async function installDaemonSystemd(
  onOutput?: InstallOutputHandler,
  onStep?: InstallStepHandler
): Promise<void> {
  onStep?.(`Install ${DAEMON_SYSTEMD_UNIT} systemd unit`, 'running')

  // Must precede systemd setup so the playbook's create-if-absent guard and the
  // daemon's first start both see the real dev-identity/connectivity contract.
  writeDaemonBaseEnv()

  const dev = resolveDevIdentity()
  const envPrefix = [
    'TURBOPANEL_SKIP_DAEMON_START=1',
    `TURBOPANEL_DEV_USER=${dev.user}`,
    `TURBOPANEL_DEV_UID=${dev.uid}`,
    `TURBOPANEL_DEV_GID=${dev.gid}`,
    `TURBOPANEL_DEV_ROOT=${shellQuote(resolveDevRoot())}`,
    `TURBOPANEL_DAEMON_ROOT=${shellQuote(DAEMON_DIR)}`,
  ].join(' ')

  const command = `cd ${shellQuote(DAEMON_DIR)} && ${envPrefix} exec bash ${shellQuote('scripts/install-daemon-systemd.sh')}`

  const code = await runCaptured(['sudo', 'bash', '-c', command], onOutput)

  if (code !== 0) {
    onStep?.(`Install ${DAEMON_SYSTEMD_UNIT} systemd unit`, 'failed')
    throw new Error('Install daemon systemd failed')
  }

  onStep?.(`Install ${DAEMON_SYSTEMD_UNIT} systemd unit`, 'ok')

  // Stop if the install script started the daemon before env was fully applied.
  await runCaptured(['sudo', '-n', 'systemctl', 'stop', DAEMON_SYSTEMD_UNIT], onOutput)

  onStep?.(`Start ${DAEMON_SYSTEMD_UNIT}`, 'running')
  const startCode = await runCaptured(
    ['sudo', '-n', 'systemctl', 'enable', '--now', DAEMON_SYSTEMD_UNIT],
    onOutput
  )
  if (startCode !== 0) {
    onStep?.(`Start ${DAEMON_SYSTEMD_UNIT}`, 'failed')
    throw new Error(`Failed to start ${DAEMON_SYSTEMD_UNIT}`)
  }
  onStep?.(`Start ${DAEMON_SYSTEMD_UNIT}`, 'ok')
}

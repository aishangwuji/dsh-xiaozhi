/**
 * Crash forensics.
 *
 * A plugin must never take the Harness down with it, and when something does
 * go wrong we need evidence on disk — the Electron process gives us no console
 * after it dies. This installs process-wide guards that append one JSON line per
 * incident to `~/.dsh-xiaozhi/crash.log` and keep the host process alive, plus a
 * wrapper that records the request path that was in flight.
 */

import { appendFile, mkdir, readFile, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const MAX_BYTES = 2 * 1024 * 1024

let installed = false
let logPath = ''

export function crashLogPath() {
  return logPath || join(process.env.DSH_XIAOZHI_HOME || join(homedir(), '.dsh-xiaozhi'), 'crash.log')
}

async function rotate(path) {
  try {
    const info = await stat(path)
    if (info.size < MAX_BYTES) return
    await rename(path, `${path}.1`).catch(() => {})
  } catch {
    // Missing file: nothing to rotate.
  }
}

async function write(entry) {
  const path = crashLogPath()
  try {
    await mkdir(dirname(path), { recursive: true })
    await rotate(path)
    await appendFile(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
  } catch {
    // Logging must never throw.
  }
}

function describe(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: String(error.stack ?? '').slice(0, 4000) }
  }
  try {
    return { name: 'non-error', message: JSON.stringify(error).slice(0, 2000) }
  } catch {
    return { name: 'non-error', message: String(error).slice(0, 2000) }
  }
}

/**
 * Install the guards once per process. Returns a small API the ingress uses to
 * mark the work in flight so a crash report says *what* was running.
 */
export function installCrashGuard({ logger } = {}) {
  logPath = crashLogPath()
  if (installed) return crashGuardApi()
  installed = true

  const handle = (kind) => (error, origin) => {
    const entry = { at: new Date().toISOString(), kind, origin, context: currentContext(), ...describe(error) }
    void write(entry)
    logger?.error?.(`dsh-xiaozhi: ${kind} recorded to ${logPath}: ${entry.message}`)
  }

  process.on('uncaughtException', handle('uncaughtException'))
  process.on('unhandledRejection', handle('unhandledRejection'))
  return crashGuardApi()
}

let context = null

function currentContext() {
  return context
}

function crashGuardApi() {
  return {
    /** Run `fn` with a label attached to any crash it causes. */
    async track(label, fn) {
      const previous = context
      context = { label, startedAt: new Date().toISOString() }
      try {
        return await fn()
      } finally {
        context = previous
      }
    },
    /** Record a handled failure without killing the process. */
    async report(kind, error, extra) {
      const described = typeof error === 'string' ? { name: 'message', message: error } : describe(error)
      await write({ at: new Date().toISOString(), kind, context: currentContext(), ...extra, ...described })
    },
    /** Last N incident lines, newest first, for the console to display. */
    async tail(limit = 20) {
      try {
        const text = await readFile(crashLogPath(), 'utf8')
        return text
          .split('\n')
          .filter(Boolean)
          .slice(-limit)
          .reverse()
          .map((line) => {
            try {
              return JSON.parse(line)
            } catch {
              return { raw: line }
            }
          })
      } catch {
        return []
      }
    },
  }
}

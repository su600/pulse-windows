import { app, dialog } from 'electron'
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Small always-on trace of startup milestones and errors, kept in the app's
 * data folder (%APPDATA%\Pulse\pulse.log) so "nothing appeared" can be
 * diagnosed. It never records tokens, keys or request headers. PULSE_LOG=<file>
 * redirects it.
 */
function logFile(): string {
  return process.env.PULSE_LOG ?? join(app.getPath('userData'), 'pulse.log')
}

let trimmed = false

export function dlog(message: string): void {
  try {
    const file = logFile()
    mkdirSync(dirname(file), { recursive: true })
    if (!trimmed) {
      trimmed = true
      if (existsSync(file) && statSync(file).size > 200_000) writeFileSync(file, '')
    }
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`)
  } catch {
    /* tracing must never break the app */
  }
}

export function installCrashHandlers(): void {
  process.on('uncaughtException', (error) => {
    dlog(`UNCAUGHT ${error.stack ?? error}`)
    if (app.isReady()) dialog.showErrorBox('Pulse', `${error.message}\n\nDetails: ${logFile()}`)
  })
  process.on('unhandledRejection', (reason) => dlog(`REJECT ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`))
  process.on('exit', (code) => dlog(`exit ${code}`))
}

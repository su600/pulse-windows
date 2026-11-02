import type { AppSettings, ProviderId, UsageSnapshot } from './types'
import { isSpent } from './rules'

export interface WindowMemory {
  warned: boolean
  exhausted: boolean
  resetsAt: number | null
}

export interface AlertMemory {
  windows: Record<string, WindowMemory>
  failures: Partial<Record<ProviderId, { count: number; notified: boolean }>>
}

export const EMPTY_MEMORY: AlertMemory = { windows: {}, failures: {} }

export type AlertEvent =
  | { kind: 'warn'; providerId: ProviderId; windowId: string; scope: string | null; percent: number }
  | { kind: 'exhausted'; providerId: ProviderId; windowId: string; scope: string | null }
  | { kind: 'reset'; providerId: ProviderId; windowId: string; scope: string | null }
  | { kind: 'failure'; providerId: ProviderId }

/** Consecutive failed reads before a failure notification. */
export const FAILURE_STREAK = 3

/** Failures that say something about the connection, not "not configured". */
const COUNTED_FAILURES = new Set(['unreachable', 'serverError', 'unreadableReply', 'rateLimited'])

/**
 * Pure alert rules. Only reports facts Pulse observed: a limit crossing the
 * chosen line, the provider saying a limit is spent, a warned limit coming
 * back, or several failed reads in a row. Memory is keyed per window, so a
 * restart never repeats an event, and a reading already past the line when the
 * switch is turned on is announced once.
 */
export function evaluateAlerts(
  memory: AlertMemory,
  snapshot: UsageSnapshot,
  settings: AppSettings['notifications']
): { events: AlertEvent[]; memory: AlertMemory } {
  const events: AlertEvent[] = []
  const next: AlertMemory = { windows: { ...memory.windows }, failures: { ...memory.failures } }
  const providerId = snapshot.providerId

  if (snapshot.availability === 'live') {
    next.failures[providerId] = { count: 0, notified: false }
    for (const w of snapshot.windows) {
      if (w.usedFraction === null && !w.isExhausted) continue
      const used = w.usedFraction ?? 0
      const prev = next.windows[w.id] ?? { warned: false, exhausted: false, resetsAt: null }
      const mem: WindowMemory = { ...prev, resetsAt: w.resetsAt ?? prev.resetsAt }
      const spent = isSpent(w)

      const cycleTurned =
        prev.resetsAt !== null && w.resetsAt !== null && w.resetsAt > prev.resetsAt + 60_000 && !spent
      if (cycleTurned && (prev.warned || prev.exhausted)) {
        if (settings.onReset && settings.warnAt > 0) events.push({ kind: 'reset', providerId, windowId: w.id, scope: w.scope })
        mem.warned = false
        mem.exhausted = false
      }

      if (settings.warnAt > 0 && !spent && used >= settings.warnAt && !mem.warned) {
        events.push({ kind: 'warn', providerId, windowId: w.id, scope: w.scope, percent: Math.round(used * 100) })
        mem.warned = true
      }
      if (settings.onExhausted && spent && !mem.exhausted) {
        events.push({ kind: 'exhausted', providerId, windowId: w.id, scope: w.scope })
        mem.exhausted = true
        mem.warned = true
      }
      // Falling back under the line without a new cycle re-arms the warning.
      if (!spent && settings.warnAt > 0 && used < settings.warnAt - 0.05) mem.warned = false
      if (!spent) mem.exhausted = false
      next.windows[w.id] = mem
    }
  } else if (COUNTED_FAILURES.has(snapshot.availability)) {
    const prev = next.failures[providerId] ?? { count: 0, notified: false }
    const count = prev.count + 1
    let notified = prev.notified
    if (settings.onFailure && count >= FAILURE_STREAK && !notified) {
      events.push({ kind: 'failure', providerId })
      notified = true
    }
    next.failures[providerId] = { count, notified }
  }

  return { events, memory: next }
}

import type { Availability, UsageSnapshot, UsageWindow } from './types'

// ------------------------------------------------------------------ colour

/** Usage colours. Colour means how close a limit is, never which provider. */
export const USAGE_COLORS = {
  dark: { good: '#00E68C', caution: '#FFC226', warning: '#FF4F42', exhausted: '#D91721' },
  light: { good: '#00945A', caution: '#C27D00', warning: '#DE382B', exhausted: '#AD0F1A' }
} as const

export type Tint = 'good' | 'caution' | 'warning' | 'exhausted'

/** Green stays below this, under every offered warning threshold. */
export const CAUTION_THRESHOLD = 0.5

export function tintFor(used: number, isExhausted: boolean, warningAt: number): Tint {
  if (isExhausted || used >= 1) return 'exhausted'
  if (used < CAUTION_THRESHOLD) return 'good'
  if (used < warningAt) return 'caution'
  return 'warning'
}

export function tintColor(tint: Tint, light: boolean): string {
  return (light ? USAGE_COLORS.light : USAGE_COLORS.dark)[tint]
}

// ------------------------------------------------------------------ windows

/**
 * Spent = the provider says so, or the allowance is used up and the service
 * will not carry on. A limit with overage allowed keeps working past its
 * included share, so it is over its allowance but not blocked.
 */
export function isSpent(window: UsageWindow | null | undefined): boolean {
  if (!window) return false
  if (window.isExhausted) return true
  return (window.usedFraction ?? 0) >= 1 && window.overage?.allowed !== true
}

/** Colour step for a window: spent is its own state; an over-allowance limit stays on the warning step. */
export function windowTint(window: UsageWindow, warningAt: number): Tint {
  if (isSpent(window)) return 'exhausted'
  return tintFor(Math.min(window.usedFraction ?? 0, 0.999), false, warningAt)
}

/** A window whose reset time has passed is history, not the current limit. */
export function dropExpired(windows: UsageWindow[], now: number): UsageWindow[] {
  return windows.filter((w) => w.resetsAt === null || w.resetsAt > now)
}

/** Whether the provider stated the window's length (needed for the clock arc). */
export function reportsLength(window: UsageWindow): boolean {
  return window.windowSeconds !== null && window.windowSeconds > 0 && window.resetsAt !== null
}

/**
 * The window a ring shows: the pinned one when it still exists, otherwise the
 * one closest to running out. Windows with no fraction never headline.
 */
export function headlineWindow(windows: UsageWindow[], pinnedId: string | null): UsageWindow | null {
  if (pinnedId) {
    const pinned = windows.find((w) => w.id === pinnedId)
    if (pinned) return pinned
  }
  let best: UsageWindow | null = null
  let bestScore = -1
  for (const w of windows) {
    if (w.usedFraction === null && !w.isExhausted) continue
    const score = w.isExhausted ? 2 : w.usedFraction ?? 0
    if (score > bestScore) {
      best = w
      bestScore = score
    }
  }
  return best
}

/** Fraction of the window that has elapsed, 0..1; null without length + reset. */
export function elapsedFraction(window: UsageWindow, now: number): number | null {
  if (!reportsLength(window)) return null
  const length = (window.windowSeconds as number) * 1000
  const start = (window.resetsAt as number) - length
  return Math.min(Math.max((now - start) / length, 0), 1)
}

export const MAX_CACHE_AGE_MS = 6 * 60 * 60 * 1000

/**
 * What the panel shows for a snapshot: expired windows removed, and a snapshot
 * that has lost every window becomes "no reading" rather than showing a stale
 * limit as current.
 */
export function effectiveSnapshot(snapshot: UsageSnapshot, now: number): UsageSnapshot {
  if (snapshot.availability !== 'live' && snapshot.origin !== 'cache') return snapshot
  const windows = dropExpired(snapshot.windows, now)
  const tooOld = now - snapshot.observedAt > MAX_CACHE_AGE_MS && snapshot.origin === 'cache'
  if (tooOld || (snapshot.windows.length > 0 && windows.length === 0 && snapshot.balance === null)) {
    return { ...snapshot, windows: [], availability: snapshot.availability === 'live' ? 'noLimitsReported' : snapshot.availability }
  }
  return windows.length === snapshot.windows.length ? snapshot : { ...snapshot, windows }
}

export function emptySnapshot(
  accountId: string,
  providerId: UsageSnapshot['providerId'],
  availability: Availability,
  now: number
): UsageSnapshot {
  return {
    accountId,
    providerId,
    availability,
    windows: [],
    plan: null,
    creditBalance: null,
    balance: null,
    observedAt: now,
    staleReason: null,
    origin: 'live',
    source: null
  }
}

// ------------------------------------------------------------------ formatting

export function percentOf(fraction: number | null, remaining: boolean): number | null {
  if (fraction === null) return null
  const used = Math.min(Math.max(fraction, 0), 1)
  return Math.round((remaining ? 1 - used : used) * 100)
}

export function formatCompactMoney(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

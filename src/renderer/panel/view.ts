import { formatCompactMoney } from '@shared/rules'
import { elapsedFraction, headlineWindow, isSpent, percentOf, windowTint, type Tint } from '@shared/rules'
import { accountSettings } from '@shared/settings'
import type { AppSettings, RailEntry, UsageWindow } from '@shared/types'

export interface RingView {
  headline: UsageWindow | null
  tint: Tint
  /** Chosen colour, if the user set one and the limit is not spent. */
  customColor: string | null
  spent: boolean
  hasReading: boolean
  /** 0..1 of the circle to draw; null = no figure, draw an empty track. */
  arc: number
  /** Text under the ring. */
  label: string
  clock: number | null
}

export function ringView(entry: RailEntry, settings: AppSettings, now: number, locale: string): RingView {
  const { snapshot } = entry
  const acct = accountSettings(settings, entry.providerId)
  const headline = headlineWindow(snapshot.windows, acct.pinnedWindow)
  const used = headline?.usedFraction ?? null
  const spent = isSpent(headline)
  const remaining = settings.panel.showsRemaining
  const hasReading = snapshot.windows.length > 0 || snapshot.balance !== null || snapshot.creditBalance !== null

  // No reading draws nothing, either way round: never invert null to "full".
  let arc = 0
  if (used !== null || spent) {
    const clamped = Math.min(Math.max(used ?? 1, 0), 1)
    arc = spent ? 1 : remaining ? 1 - clamped : clamped
  }

  let label = '–'
  const pct = percentOf(used, remaining)
  if (headline && pct !== null) label = `${spent && used === null ? 100 : pct}%`
  else if (snapshot.balance) {
    label = formatCompactMoney(snapshot.balance.amount, snapshot.balance.currency, locale).replace(/\.00$/, '')
  }

  return {
    headline,
    tint: headline ? windowTint(headline, settings.panel.warningThreshold) : 'good',
    customColor: spent ? null : acct.ringTint,
    spent,
    hasReading,
    arc,
    label,
    clock: settings.panel.showWindowClock && headline ? elapsedFraction(headline, now) : null
  }
}

/** Worst headline across the rail, for the collapsed sliver's alert colour. */
export function alertTint(entries: RailEntry[], settings: AppSettings): Tint | null {
  let worst: Tint | null = null
  const order: Tint[] = ['good', 'caution', 'warning', 'exhausted']
  for (const e of entries) {
    const h = headlineWindow(e.snapshot.windows, accountSettings(settings, e.providerId).pinnedWindow)
    if (!h) continue
    const tint = windowTint(h, settings.panel.warningThreshold)
    if (tint === 'good' || tint === 'caution') continue
    if (worst === null || order.indexOf(tint) > order.indexOf(worst)) worst = tint
  }
  return worst
}

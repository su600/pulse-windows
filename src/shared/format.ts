import type { Availability, ProviderId, UsageWindow } from './types'
import type { Locale, T } from './i18n'

/** Title of a limit row: its kind, plus the model group it is scoped to. */
export function windowTitle(w: UsageWindow, t: T): string {
  let base: string
  switch (w.kind) {
    case 'fiveHour': base = t('win.fiveHour'); break
    case 'weekly': base = t('win.weekly'); break
    case 'monthly': base = t('win.monthly'); break
    case 'daily': base = t('win.daily'); break
    case 'spend': base = t('win.spend'); break
    case 'balance': base = t('win.balance'); break
    case 'credits': base = t('win.credits'); break
    default: {
      const s = w.windowSeconds
      if (s && s >= 86_400 && s % 86_400 === 0) base = t('win.otherDays', { n: s / 86_400 })
      else if (s) base = t('win.otherHours', { n: Math.max(Math.round(s / 3600), 1) })
      else base = t('win.limit')
    }
  }
  return w.scope ? `${base} · ${w.scope}` : base
}

/** Message for a state; CLI-backed providers get a more specific remedy than the generic one. */
/** "7,360 of 7,000 credits" and, past the allowance, "Over by 360 credits · extra usage allowed". */
/** Credits to US dollars, as given by the user: 100 credits = $1. Not a figure the service reports. */
export const CREDITS_PER_USD = 100

export function creditsToUsd(credits: number): number {
  return Math.round((credits / CREDITS_PER_USD) * 100) / 100
}

export function amountLines(w: UsageWindow, t: T, locale: Locale): { amount: string | null; over: string | null } {
  const nf = new Intl.NumberFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 1 })
  const unit = w.amounts ? t(`unit.${w.amounts.unit}` as 'unit.credits') : ''
  const amount = w.amounts ? t('card.amount', { used: nf.format(w.amounts.used), limit: nf.format(w.amounts.limit), unit }) : null
  let over: string | null = null
  if (w.overage && w.overage.over > 0) {
    const n = nf.format(w.overage.over)
    if (w.overage.allowed && w.amounts?.unit === 'credits') {
      const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(creditsToUsd(w.overage.over))
      over = t('card.overUsd', { n, unit, usd })
    } else {
      over = t(w.overage.allowed ? 'card.over' : 'card.overBlocked', { n, unit })
    }
  }
  return { amount, over }
}

export function availabilityText(a: Availability, t: T, provider?: { id: ProviderId; name: string; credential: string }): string {
  if (provider?.credential === 'cli') {
    if (a === 'notConnected') return t('av.cliNotFound', { name: provider.name })
    if (a === 'signInRequired') return t('av.cliSignIn', { name: provider.name })
  }
  return t(`av.${a}` as 'av.live')
}

/** "Oct 4 at 1:07 AM" / "10月4日 01:07". */
export function formatReset(ms: number, locale: Locale): string {
  const d = new Date(ms)
  if (locale === 'zh-CN') {
    const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(d)
    const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
    return `${date} ${time}`
  }
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d)
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(d)
  return `${date} at ${time}`
}

export function formatUpdated(observedAt: number, now: number, t: T): string {
  const minutes = Math.floor((now - observedAt) / 60_000)
  if (minutes < 1) return t('card.updatedNow')
  if (minutes < 60) return t('card.updatedMin', { n: minutes })
  return t('card.updatedHr', { n: Math.floor(minutes / 60) })
}

export function formatClock(ms: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }).format(new Date(ms))
}


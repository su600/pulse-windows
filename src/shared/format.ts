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


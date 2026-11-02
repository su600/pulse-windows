import type { ProviderId, UsageWindow } from '@shared/types'
import type { AdapterResult, ProviderAdapter } from './types'

/** Synthetic readings for screenshots and UI work (PULSE_DEMO=1). No network. */
const DAY = 86_400_000

function demoWindows(id: string, used: number[], now: number, titles?: Array<string | null>): UsageWindow[] {
  return used.map((u, i) => ({
    id: `${id}.${i}`,
    kind: i === 0 ? 'monthly' : 'weekly',
    scope: titles?.[i] ?? null,
    usedFraction: u,
    windowSeconds: null,
    resetsAt: now + (8 + i * 3) * DAY,
    isExhausted: false
  }))
}

const READINGS: Record<string, { used: number[]; titles?: Array<string | null>; plan: string }> = {
  demo1: { used: [0.06, 0.12], titles: ['Sonnet', null], plan: 'Max 5x' },
  demo2: { used: [0.89], plan: 'Pro' },
  demo3: { used: [0.02, 0.0], titles: ['Cursor Models', 'Other Models'], plan: 'Pro' },
  demo4: { used: [0.01], plan: 'Core' },
  demo5: { used: [0.22], plan: 'Pro+' },
  demo6: { used: [0.15], plan: 'Plus' }
}

export function demoAdapter(id: ProviderId): ProviderAdapter {
  return {
    id,
    async fetch(ctx): Promise<AdapterResult> {
      const r = READINGS[id]
      return { availability: 'live', windows: demoWindows(id, r.used, ctx.now, r.titles), plan: r.plan, source: 'Demo data' }
    }
  }
}

import { describe, expect, it } from 'vitest'
import { RefreshCoordinator, type Timers } from '../src/main/coordinator'
import type { AdapterResult } from '../src/main/providers/types'
import type { ProviderId, UsageSnapshot, UsageWindow } from '../src/shared/types'

const W = (used: number, resetsAt: number | null = null): UsageWindow => ({
  id: 'w', kind: 'monthly', scope: null, usedFraction: used, windowSeconds: null, resetsAt, isExhausted: false
})

function harness(initial: Partial<Record<ProviderId, UsageSnapshot>> = {}) {
  let now = 1_000_000
  const calls: ProviderId[] = []
  const pending: Array<{ id: ProviderId; resolve: (r: AdapterResult) => void }> = []
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = []
  const fakeTimers: Timers = {
    set: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t },
    clear: (h) => { (h as { live: boolean }).live = false }
  }
  const seen: UsageSnapshot[] = []
  let persisted: Partial<Record<ProviderId, UsageSnapshot>> = {}
  const c = new RefreshCoordinator({
    now: () => now,
    run: (id) => { calls.push(id); return new Promise((resolve) => pending.push({ id, resolve })) },
    initial,
    persist: (s) => { persisted = s },
    onSnapshot: (s) => seen.push(s),
    onChange: () => {},
    timers: fakeTimers,
    minRefreshMs: 0
  })
  const settle = async (r: AdapterResult, index = 0) => { pending[index].resolve(r); await Promise.resolve(); await new Promise((r2) => setImmediate(r2)) }
  return { c, calls, pending, seen, timers, settle, advance: (ms: number) => { now += ms }, persisted: () => persisted }
}

describe('refresh coordinator', () => {
  it('reads nothing for an account that is not enabled', async () => {
    const h = harness()
    h.c.start()
    await h.c.refresh('copilot')
    expect(h.calls).toEqual([])
  })

  it('runs one read per account: a click while one is out joins it', async () => {
    const h = harness()
    h.c.setEnabled(['copilot'])
    h.c.start()
    void h.c.refresh('copilot')
    void h.c.refresh('copilot')
    expect(h.calls).toEqual(['copilot'])
  })

  it('shows live figures and keeps the last good ones, marked stale, when a later read fails', async () => {
    const h = harness()
    h.c.setEnabled(['copilot'])
    h.c.start()
    await h.settle({ availability: 'live', windows: [W(0.3)], plan: 'Individual' })
    expect(h.c.snapshotFor('copilot')).toMatchObject({ availability: 'live', origin: 'live', plan: 'Individual' })

    h.advance(60_000)
    const second = h.c.refresh('copilot')
    await h.settle({ availability: 'unreachable' }, 1)
    await second
    const s = h.c.snapshotFor('copilot')!
    expect(s.origin).toBe('cache')
    expect(s.staleReason).toBe('unreachable')
    expect(s.windows[0].usedFraction).toBe(0.3)
  })

  it('does not keep cached figures after a refused key or a removed login', async () => {
    const h = harness()
    h.c.setEnabled(['deepseek'])
    h.c.start()
    await h.settle({ availability: 'live', balance: { amount: 5, currency: 'CNY' }, windows: [] })
    const next = h.c.refresh('deepseek')
    await h.settle({ availability: 'keyRefused' }, 1)
    await next
    expect(h.c.snapshotFor('deepseek')).toMatchObject({ availability: 'keyRefused', origin: 'live', balance: null })
  })

  it('discards the answer of a read that was superseded by disabling the account', async () => {
    const h = harness()
    h.c.setEnabled(['codex'])
    h.c.start()
    h.c.setEnabled([])
    await h.settle({ availability: 'live', windows: [W(0.9)] })
    expect(h.c.snapshotFor('codex')).toBeUndefined()
    expect(h.seen).toEqual([])
  })

  it('does not let an old read overwrite a newer one after re-enabling', async () => {
    const h = harness()
    h.c.setEnabled(['codex'])
    h.c.start()
    h.c.setEnabled([])
    h.c.setEnabled(['codex'])
    expect(h.calls).toEqual(['codex', 'codex'])
    await h.settle({ availability: 'live', windows: [W(0.9)] }, 0) // old
    expect(h.c.snapshotFor('codex')?.windows ?? []).toEqual([])
    await h.settle({ availability: 'live', windows: [W(0.1)] }, 1) // new
    expect(h.c.snapshotFor('codex')?.windows[0].usedFraction).toBe(0.1)
  })

  it('restores the last good snapshot on enable and shows it as cache until the first read lands', () => {
    const saved: UsageSnapshot = {
      accountId: 'copilot', providerId: 'copilot', availability: 'live', windows: [W(0.4)], plan: null,
      creditBalance: null, balance: null, observedAt: 900_000, staleReason: null, origin: 'live', source: null
    }
    const h = harness({ copilot: saved })
    h.c.setEnabled(['copilot'])
    expect(h.c.snapshotFor('copilot')).toMatchObject({ origin: 'cache', windows: [{ usedFraction: 0.4 }] })
  })

  it('schedules a single timer for the earliest due account, not a poll', async () => {
    const h = harness()
    h.c.setInterval(300)
    h.c.setEnabled(['copilot'])
    h.c.start()
    await h.settle({ availability: 'live', windows: [W(0.3)] })
    const live = h.timers.filter((t) => t.live)
    expect(live.length).toBe(1)
    expect(live[0].ms).toBe(300_000)
  })

  it('eases off after a rate limit', async () => {
    const h = harness()
    h.c.setInterval(300)
    h.c.setEnabled(['copilot'])
    h.c.start()
    await h.settle({ availability: 'rateLimited' })
    const live = h.timers.filter((t) => t.live)
    expect(live[live.length - 1].ms).toBe(600_000)
  })
})

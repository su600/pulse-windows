import { describe, expect, it } from 'vitest'
import { EMPTY_MEMORY, evaluateAlerts, FAILURE_STREAK } from '../src/shared/alerts'
import { computeFrame, metricsFor, railLength, ringCentre } from '../src/shared/layout'
import { dropExpired, effectiveSnapshot, elapsedFraction, emptySnapshot, headlineWindow, percentOf, tintFor } from '../src/shared/rules'
import { DEFAULT_SETTINGS, type UsageSnapshot, type UsageWindow } from '../src/shared/types'

const NOW = 1_800_000_000_000
const win = (over: Partial<UsageWindow> = {}): UsageWindow => ({
  id: 'w',
  kind: 'weekly',
  scope: null,
  usedFraction: 0.3,
  windowSeconds: 7 * 86_400,
  resetsAt: NOW + 3_600_000,
  isExhausted: false,
  ...over
})
const snap = (windows: UsageWindow[], over: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  ...emptySnapshot('claudeCode', 'claudeCode', 'live', NOW),
  windows,
  ...over
})

describe('colour', () => {
  it('means how close a limit is, with the warning step configurable', () => {
    expect(tintFor(0.2, false, 0.75)).toBe('good')
    expect(tintFor(0.5, false, 0.75)).toBe('caution')
    expect(tintFor(0.74, false, 0.75)).toBe('caution')
    expect(tintFor(0.75, false, 0.75)).toBe('warning')
    expect(tintFor(0.75, false, 0.9)).toBe('caution')
  })
  it('lets the provider say spent below 100%', () => {
    expect(tintFor(0.4, true, 0.75)).toBe('exhausted')
    expect(tintFor(1, false, 0.75)).toBe('exhausted')
  })
})

describe('headline window', () => {
  it('picks the fullest, prefers spent, honours a pin, ignores windows with no figure', () => {
    const a = win({ id: 'a', usedFraction: 0.2 })
    const b = win({ id: 'b', usedFraction: 0.6 })
    const c = win({ id: 'c', usedFraction: 0.3, isExhausted: true })
    const none = win({ id: 'n', usedFraction: null })
    expect(headlineWindow([a, b], null)?.id).toBe('b')
    expect(headlineWindow([a, b, c], null)?.id).toBe('c')
    expect(headlineWindow([a, b], 'a')?.id).toBe('a')
    expect(headlineWindow([a, b], 'gone')?.id).toBe('b')
    expect(headlineWindow([none], null)).toBeNull()
  })
})

describe('expiry', () => {
  it('drops windows whose reset has passed and keeps ones with no reset', () => {
    const kept = dropExpired([win({ id: 'old', resetsAt: NOW - 1 }), win({ id: 'new' }), win({ id: 'none', resetsAt: null })], NOW)
    expect(kept.map((w) => w.id)).toEqual(['new', 'none'])
  })
  it('turns a snapshot whose every window expired into "no reading", not a stale limit', () => {
    const s = effectiveSnapshot(snap([win({ resetsAt: NOW - 5 })]), NOW)
    expect(s.windows).toEqual([])
    expect(s.availability).toBe('noLimitsReported')
  })
  it('refuses very old cached data', () => {
    const old = snap([win()], { origin: 'cache', observedAt: NOW - 7 * 3_600_000, staleReason: 'unreachable' })
    expect(effectiveSnapshot(old, NOW).windows).toEqual([])
  })
})

describe('clock arc', () => {
  it('needs both a reported length and a reset', () => {
    expect(elapsedFraction(win({ windowSeconds: null }), NOW)).toBeNull()
    expect(elapsedFraction(win({ resetsAt: null }), NOW)).toBeNull()
    const half = win({ windowSeconds: 7200, resetsAt: NOW + 3_600_000 })
    expect(elapsedFraction(half, NOW)).toBeCloseTo(0.5)
  })
})

describe('percent', () => {
  it('counts used or remaining and never invents a figure', () => {
    expect(percentOf(0.46, false)).toBe(46)
    expect(percentOf(0.46, true)).toBe(54)
    expect(percentOf(1.4, false)).toBe(100)
    expect(percentOf(null, true)).toBeNull()
  })
})

describe('alerts', () => {
  const settings = { warnAt: 0.75, onExhausted: true, onReset: true, onFailure: true }

  it('warns once when the line is crossed, also for a reading already past it, and survives a restart', () => {
    let r = evaluateAlerts(EMPTY_MEMORY, snap([win({ usedFraction: 0.8 })]), settings)
    expect(r.events.map((e) => e.kind)).toEqual(['warn'])
    r = evaluateAlerts(JSON.parse(JSON.stringify(r.memory)), snap([win({ usedFraction: 0.85 })]), settings)
    expect(r.events).toEqual([])
  })

  it('announces a spent limit once, and a reset of a warned limit once', () => {
    let r = evaluateAlerts(EMPTY_MEMORY, snap([win({ usedFraction: 0.5, isExhausted: true })]), settings)
    expect(r.events.map((e) => e.kind)).toEqual(['exhausted'])
    r = evaluateAlerts(r.memory, snap([win({ usedFraction: 0.5, isExhausted: true })]), settings)
    expect(r.events).toEqual([])
    r = evaluateAlerts(r.memory, snap([win({ usedFraction: 0.01, resetsAt: NOW + 7 * 86_400_000 })]), settings)
    expect(r.events.map((e) => e.kind)).toEqual(['reset'])
  })

  it('says nothing when everything is off', () => {
    const off = { warnAt: 0, onExhausted: false, onReset: false, onFailure: false }
    expect(evaluateAlerts(EMPTY_MEMORY, snap([win({ usedFraction: 0.99, isExhausted: true })]), off).events).toEqual([])
  })

  it('reports a failure only after a streak, once, and not for "not connected"', () => {
    let memory = EMPTY_MEMORY
    const events: string[] = []
    for (let i = 0; i < FAILURE_STREAK + 2; i++) {
      const r = evaluateAlerts(memory, snap([], { availability: 'unreachable' }), settings)
      memory = r.memory
      events.push(...r.events.map((e) => e.kind))
    }
    expect(events).toEqual(['failure'])
    expect(evaluateAlerts(EMPTY_MEMORY, snap([], { availability: 'notConnected' }), settings).memory.failures.claudeCode).toBeUndefined()
  })
})

describe('layout', () => {
  const base = { count: 4, showsPercentages: true, detailedCards: false, ratio: 0.5, free: null }
  const work = { x: 0, y: 0, width: 1920, height: 1040 }

  it('uses whole numbers and fits the tallest card, not just the rail', () => {
    const m = metricsFor(DEFAULT_SETTINGS)
    const { frame, panel } = computeFrame({ ...base, m, position: 'right', workArea: work, count: 1 })
    expect(Number.isInteger(frame.width) && Number.isInteger(frame.height)).toBe(true)
    expect(frame.height).toBeGreaterThanOrEqual(panel.rail.height)
    expect(frame.x + frame.width).toBe(work.width)
    expect(panel.cardSide).toBe('left')
  })

  it('does not resize when a card opens (frame is a function of settings and ring count only)', () => {
    const m = metricsFor(DEFAULT_SETTINGS)
    const a = computeFrame({ ...base, m, position: 'right', workArea: work })
    const b = computeFrame({ ...base, m, position: 'right', workArea: work })
    expect(a).toEqual(b)
  })

  it('keeps the rail on screen when the dock ratio is at an extreme', () => {
    const m = metricsFor(DEFAULT_SETTINGS)
    const top = computeFrame({ ...base, m, position: 'left', workArea: work, ratio: 0 })
    const bottom = computeFrame({ ...base, m, position: 'left', workArea: work, ratio: 1 })
    expect(top.frame.y).toBeGreaterThanOrEqual(0)
    expect(bottom.frame.y + bottom.frame.height).toBeLessThanOrEqual(work.height)
    expect(top.panel.cardSide).toBe('right')
  })

  it('places ring centres on the rail axis, one step apart', () => {
    const m = metricsFor(DEFAULT_SETTINGS)
    const a = ringCentre(m, 0, true, true)
    const b = ringCentre(m, 1, true, true)
    expect(a.x).toBe(m.railWidth / 2)
    expect(b.y - a.y).toBeCloseTo(m.ringDiameter + m.ringToText + m.percentHeight + m.itemGap)
    expect(railLength(m, 2, true, true)).toBeGreaterThan(b.y + m.ringDiameter / 2)
  })
})

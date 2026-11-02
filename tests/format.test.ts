import { describe, expect, it } from 'vitest'
import { amountLines, creditsToUsd } from '../src/shared/format'
import { translator } from '../src/shared/i18n'
import type { UsageWindow } from '../src/shared/types'

const w = (over: Partial<UsageWindow>): UsageWindow => ({
  id: 'x', kind: 'monthly', scope: null, usedFraction: 1.05, windowSeconds: null, resetsAt: null, isExhausted: false, ...over
})

describe('credit overage in dollars (100 credits = $1)', () => {
  it('converts credits to dollars to the cent', () => {
    expect(creditsToUsd(360)).toBe(3.6)
    expect(creditsToUsd(361)).toBe(3.61)
    expect(creditsToUsd(0.5)).toBe(0.01)
    expect(creditsToUsd(0)).toBe(0)
  })

  it('shows the used/allowance line and the extra dollars for an allowed credit overage', () => {
    const lines = amountLines(
      w({ amounts: { used: 7360, limit: 7000, unit: 'credits' }, overage: { over: 360, allowed: true, limit: 2000 } }),
      translator('en'), 'en'
    )
    expect(lines.amount).toBe('7,360 of 7,000 credits')
    expect(lines.over).toBe('Over by 360 credits · $3.60 extra')
  })

  it('speaks Chinese too', () => {
    const lines = amountLines(
      w({ amounts: { used: 7360, limit: 7000, unit: 'credits' }, overage: { over: 360, allowed: true, limit: null } }),
      translator('zh-CN'), 'zh-CN'
    )
    expect(lines.amount).toBe('已用 7,360 / 7,000 积分')
    expect(lines.over).toBe('已超出 360 积分 · 额外 $3.60')
  })

  it('shows no dollars where the unit is not credits, or the overage is not allowed', () => {
    const t = translator('en')
    expect(amountLines(w({ amounts: { used: 237, limit: 200, unit: 'requests' }, overage: { over: 37, allowed: true, limit: null } }), t, 'en').over)
      .toBe('Over by 37 requests · extra usage allowed')
    expect(amountLines(w({ amounts: { used: 7360, limit: 7000, unit: 'credits' }, overage: { over: 360, allowed: false, limit: null } }), t, 'en').over)
      .toBe('Over by 360 credits')
  })

  it('shows nothing extra when within the allowance', () => {
    const lines = amountLines(w({ usedFraction: 0.4, amounts: { used: 2800, limit: 7000, unit: 'credits' }, overage: null }), translator('en'), 'en')
    expect(lines.over).toBeNull()
    expect(lines.amount).toBe('2,800 of 7,000 credits')
  })
})

import { describe, expect, it } from 'vitest'
import { ringView } from '../src/renderer/panel/view'
import { parseCopilotUsage } from '../src/main/providers/copilot'
import { emptySnapshot } from '../src/shared/rules'
import { DEFAULT_SETTINGS, type RailEntry, type UsageSnapshot } from '../src/shared/types'
import overage from './fixtures/copilot-pro-plus-credits.json'
import normal from './fixtures/copilot-normal.json'
import requestsOverage from './fixtures/copilot-overage.json'

const NOW = Date.parse('2026-11-02T00:00:00Z')

function entryFrom(json: Record<string, unknown>): RailEntry {
  const r = parseCopilotUsage(json)
  const snapshot: UsageSnapshot = { ...emptySnapshot('copilot', 'copilot', 'live', NOW), windows: r.windows ?? [], plan: r.plan ?? null }
  return { providerId: 'copilot', name: 'GitHub Copilot', icon: 'github', snapshot, isRefreshing: false }
}

describe('what the ring shows under it', () => {
  it('shows the extra charge in dollars, not 100%, once the credit allowance is used up and overage is on', () => {
    const v = ringView(entryFrom(overage), DEFAULT_SETTINGS, NOW, 'en-US')
    expect(v.label).toBe('$3.60')
    expect(v.isOverageCost).toBe(true)
    expect(v.arc).toBe(1)
    // over the allowance but still working: the red warning step, not the deep "spent" colour
    expect(v.tint).toBe('warning')
  })

  it('also replaces the figure when the setting counts down (what is left)', () => {
    const v = ringView(entryFrom(overage), { ...DEFAULT_SETTINGS, panel: { ...DEFAULT_SETTINGS.panel, showsRemaining: true } }, NOW, 'en-US')
    expect(v.label).toBe('$3.60')
  })

  it('shows an ordinary percentage while within the allowance', () => {
    const v = ringView(entryFrom(normal), DEFAULT_SETTINGS, NOW, 'en-US')
    expect(v.label).toBe('30%')
    expect(v.isOverageCost).toBe(false)
  })

  it('keeps the percentage when the overage is counted in requests (no price is known)', () => {
    const v = ringView(entryFrom(requestsOverage), DEFAULT_SETTINGS, NOW, 'en-US')
    expect(v.label).toBe('100%')
    expect(v.isOverageCost).toBe(false)
  })
})

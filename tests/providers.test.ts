import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeCode, claudePlanName, parseClaudeUsage, resetClaudePlanCache } from '../src/main/providers/claudeCode'
import { codex, codexPlanName, parseCodexUsage } from '../src/main/providers/codex'
import { copilot, copilotPlanName, parseCopilotUsage } from '../src/main/providers/copilot'
import { deepseek, parseDeepSeekBalance } from '../src/main/providers/deepseek'
import type { FetchContext, HttpFn } from '../src/main/providers/types'

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(__dirname, 'fixtures', `${name}.json`), 'utf8'))

const RESET = Date.parse('2026-10-01T00:00:00Z')

function ctx(overrides: Partial<FetchContext> & { http?: HttpFn } = {}): FetchContext {
  return {
    http: async () => ({ status: 500, text: '' }),
    now: Date.parse('2026-09-20T00:00:00Z'),
    homeDir: 'C:\\Users\\test',
    env: {},
    readFile: () => null,
    secret: null,
    ...overrides
  }
}

describe('GitHub Copilot', () => {
  it('turns three quotas into used fractions, inverted from what is left', () => {
    const r = parseCopilotUsage(fixture('copilot-normal'))
    expect(r.availability).toBe('live')
    expect(r.windows!.map((w) => w.id)).toEqual(['copilot.premium_interactions', 'copilot.chat', 'copilot.completions'])
    expect(r.windows!.map((w) => w.scope)).toEqual(['Premium requests', 'Chat', 'Completions'])
    expect(r.windows![0].usedFraction).toBeCloseTo(0.3)
    expect(r.windows![1].usedFraction).toBeCloseTo(0.1)
    expect(r.windows![2].usedFraction).toBeCloseTo(0.05)
    expect(r.windows!.every((w) => !w.isExhausted)).toBe(true)
    expect(r.windows!.every((w) => w.resetsAt === RESET)).toBe(true)
    // A calendar month has no stated length: the clock arc must not draw.
    expect(r.windows!.every((w) => w.windowSeconds === null)).toBe(true)
    expect(r.plan).toBe('Individual')
  })

  it('drops unissued and unlimited lanes but keeps a spent one', () => {
    const r = parseCopilotUsage(fixture('copilot-unissued-and-spent'))
    expect(r.windows!.map((w) => w.id)).toEqual(['copilot.chat'])
    expect(r.windows![0].usedFraction).toBe(1)
    expect(r.windows![0].isExhausted).toBe(true)
  })

  it('does not read a lane with overage permitted as spent', () => {
    const r = parseCopilotUsage(fixture('copilot-overage'))
    expect(r.windows![0].usedFraction).toBe(1)
    expect(r.windows![0].isExhausted).toBe(false)
    expect(r.windows![0].overage).toMatchObject({ allowed: true, over: 37 })
  })

  it('handles the older shape without has_quota', () => {
    const r = parseCopilotUsage(fixture('copilot-older-shape'))
    expect(r.windows!.map((w) => w.id)).toEqual(['copilot.completions'])
    expect(r.windows![0].isExhausted).toBe(true)
    expect(r.windows![0].resetsAt).toBe(RESET)
  })

  it('reports no limits for an empty reply', () => {
    const r = parseCopilotUsage(fixture('copilot-empty'))
    expect(r.availability).toBe('noLimitsReported')
    expect(r.plan).toBeNull()
  })

  it('recognises Pro+ from the sku (the plan field says individual_pro for both Pro and Pro+)', () => {
    const r = parseCopilotUsage(fixture('copilot-pro-plus-credits'))
    expect(r.plan).toBe('Pro+')
    expect(copilotPlanName('individual_pro', 'monthly_subscriber_quota')).toBe('Pro')
    expect(copilotPlanName('individual_pro', 'plus_monthly_subscriber_quota')).toBe('Pro+')
    expect(copilotPlanName(undefined, 'free_limited_copilot')).toBe('Free')
    expect(copilotPlanName('some_new_plan')).toBe('Some New Plan')
  })

  it('reads credit billing: used / allowance, how far over, and that extra usage is allowed', () => {
    const r = parseCopilotUsage(fixture('copilot-pro-plus-credits'))
    // chat and completions are unlimited: no ring for them
    expect(r.windows!.map((w) => w.id)).toEqual(['copilot.premium_interactions'])
    const w = r.windows![0]
    expect(w.amounts).toEqual({ used: 7360, limit: 7000, unit: 'credits' })
    expect(w.usedFraction).toBeCloseTo(7360 / 7000)
    expect(w.overage).toEqual({ over: 360, allowed: true, limit: 2000 })
    // over the allowance, but the service carries on: not "spent"
    expect(w.isExhausted).toBe(false)
  })

  it('tidies plan names and passes unknown ones through', () => {
    expect(copilotPlanName('individual')).toBe('Individual')
    expect(copilotPlanName('  business ')).toBe('Business')
    expect(copilotPlanName('MysteryPlan')).toBe('MysteryPlan')
    expect(copilotPlanName('')).toBeNull()
  })

  it('sends the token scheme and editor headers, and maps statuses', async () => {
    let seen: Record<string, string> = {}
    const ok = await copilot.fetch(
      ctx({
        secret: 'gho_test',
        http: async (_url, init) => {
          seen = init?.headers ?? {}
          return { status: 200, text: JSON.stringify(fixture('copilot-normal')) }
        }
      })
    )
    expect(ok.availability).toBe('live')
    expect(seen.Authorization).toBe('token gho_test')
    expect(seen['Editor-Version']).toMatch(/^vscode\//)

    expect((await copilot.fetch(ctx())).availability).toBe('notConnected')
    for (const [status, expected] of [[401, 'signInRequired'], [429, 'rateLimited'], [500, 'serverError']] as const) {
      const r = await copilot.fetch(ctx({ secret: 'x', http: async () => ({ status, text: '' }) }))
      expect(r.availability).toBe(expected)
    }
    const unreachable = await copilot.fetch(ctx({ secret: 'x', http: async () => { throw new Error('down') } }))
    expect(unreachable.availability).toBe('unreachable')
    const garbled = await copilot.fetch(ctx({ secret: 'x', http: async () => ({ status: 200, text: 'not json' }) }))
    expect(garbled.availability).toBe('unreadableReply')
  })
})

describe('Claude Code', () => {
  const limits = {
    limits: [
      { kind: 'session', percent: 12, resets_at: '2026-09-20T05:00:00.000Z', severity: 'normal' },
      { kind: 'weekly_all', percent: 40, resets_at: '2026-09-24T00:00:00Z', severity: 'warning' },
      { kind: 'weekly_scoped', percent: 76, resets_at: '2026-09-24T00:00:00Z', severity: 'warning', scope: { model: { display_name: 'Opus' } } },
      { kind: 'something_new', percent: 5 }
    ]
  }

  it('parses the limits array, including per-model windows', () => {
    const r = parseClaudeUsage(limits, 'Max 5x')
    expect(r.availability).toBe('live')
    expect(r.windows!.map((w) => [w.kind, w.scope, w.usedFraction])).toEqual([
      ['fiveHour', null, 0.12],
      ['weekly', null, 0.4],
      ['weekly', 'Opus', 0.76]
    ])
    expect(r.windows![0].windowSeconds).toBe(18_000)
    expect(r.plan).toBe('Max 5x')
  })

  it('does not call a warning severity spent, but does call a locked limit spent', () => {
    expect(parseClaudeUsage(limits, null).windows!.every((w) => !w.isExhausted)).toBe(true)
    const locked = parseClaudeUsage({ limits: [{ kind: 'session', percent: 80, locked_reason: 'rate_limited' }] }, null)
    expect(locked.windows![0].isExhausted).toBe(true)
    const odd = parseClaudeUsage({ limits: [{ kind: 'session', percent: 80, severity: 'blocked' }] }, null)
    expect(odd.windows![0].isExhausted).toBe(true)
  })

  it('falls back to the top-level five_hour / seven_day pair', () => {
    const r = parseClaudeUsage({ five_hour: { utilization: 9, resets_at: '2026-09-20T05:00:00Z' }, seven_day: { utilization: 15 } }, null)
    expect(r.windows!.map((w) => w.id)).toEqual(['claudeCode.five_hour', 'claudeCode.seven_day'])
    expect(r.windows![1].resetsAt).toBeNull()
  })

  it('names plans from the profile', () => {
    expect(claudePlanName({ organization: { rate_limit_tier: 'default_claude_max_5x' } })).toBe('Max 5x')
    expect(claudePlanName({ subscription_type: 'pro' })).toBe('Pro')
    expect(claudePlanName({ subscription_type: 'weird_plan' })).toBe('Weird Plan')
    expect(claudePlanName({})).toBeNull()
  })

  it('does not spend a call on an expired token, and never renews it', async () => {
    resetClaudePlanCache()
    let calls = 0
    const expired = JSON.stringify({ claudeAiOauth: { accessToken: 't', expiresAt: Date.parse('2026-09-19T00:00:00Z') } })
    const r = await claudeCode.fetch(ctx({ readFile: () => expired, http: async () => { calls++; return { status: 200, text: '{}' } } }))
    expect(r.availability).toBe('loginExpired')
    expect(calls).toBe(0)
    expect((await claudeCode.fetch(ctx())).availability).toBe('notConnected')
  })

  it('reads the credentials file, sends the beta header, and reads the plan once', async () => {
    resetClaudePlanCache()
    const creds = JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: Date.parse('2026-09-21T00:00:00Z') } })
    const urls: string[] = []
    let auth = ''
    const http: HttpFn = async (url, init) => {
      urls.push(url)
      auth = init?.headers?.Authorization ?? ''
      if (url.endsWith('/profile')) return { status: 200, text: JSON.stringify({ subscription_type: 'pro' }) }
      return { status: 200, text: JSON.stringify(limits) }
    }
    const first = await claudeCode.fetch(ctx({ readFile: () => creds, http }))
    expect(first.availability).toBe('live')
    expect(auth).toBe('Bearer tok')
    expect(first.plan).toBe('Pro')
    await claudeCode.fetch(ctx({ readFile: () => creds, http }))
    expect(urls.filter((u) => u.endsWith('/profile')).length).toBe(1)
  })
})

describe('Codex', () => {
  const reply = {
    plan_type: 'prolite',
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: { used_percent: 46, limit_window_seconds: 604800, reset_at: 1_790_000_000 },
      secondary_window: null
    },
    additional_rate_limits: [
      { limit_name: 'GPT-5-Codex', metered_feature: 'codex_other', rate_limit: { limit_reached: true, primary_window: { used_percent: 100, limit_window_seconds: 18000, reset_at: 1_789_990_000 } } }
    ],
    credits: { balance: '2500.0000000000', unlimited: false }
  }

  it('keys a window by its duration, not its slot', () => {
    const r = parseCodexUsage(reply)
    expect(r.windows![0]).toMatchObject({ id: 'codex.primary_window', kind: 'weekly', usedFraction: 0.46, resetsAt: 1_790_000_000_000 })
    expect(r.windows![1]).toMatchObject({ id: 'codex_other.primary_window', kind: 'fiveHour', scope: 'GPT-5-Codex', isExhausted: true })
    expect(r.plan).toBe('Pro 5x')
    expect(r.creditBalance).toBe('2,500')
  })

  it('marks only the fullest window of a reached group as spent', () => {
    const r = parseCodexUsage({
      rate_limit: {
        limit_reached: true,
        primary_window: { used_percent: 30, limit_window_seconds: 18000, reset_at: 1 },
        secondary_window: { used_percent: 100, limit_window_seconds: 604800, reset_at: 2 }
      }
    })
    expect(r.windows!.map((w) => w.isExhausted)).toEqual([false, true])
  })

  it('has no balance for unlimited credits and reports no limits when empty', () => {
    expect(parseCodexUsage({ ...reply, credits: { unlimited: true } }).creditBalance).toBeNull()
    expect(parseCodexUsage({}).availability).toBe('noLimitsReported')
    expect(codexPlanName('mystery')).toBe('mystery')
  })

  it('names the account in a header only when it knows it', async () => {
    const seen: Array<Record<string, string>> = []
    const http: HttpFn = async (_u, init) => { seen.push(init?.headers ?? {}); return { status: 200, text: JSON.stringify(reply) } }
    await codex.fetch(ctx({ readFile: () => JSON.stringify({ tokens: { access_token: 'a', account_id: 'acct' } }), http }))
    await codex.fetch(ctx({ readFile: () => JSON.stringify({ tokens: { access_token: 'a' } }), http }))
    expect(seen[0]['ChatGPT-Account-Id']).toBe('acct')
    expect('ChatGPT-Account-Id' in seen[1]).toBe(false)
    const refused = await codex.fetch(ctx({ readFile: () => JSON.stringify({ tokens: { access_token: 'a' } }), http: async () => ({ status: 401, text: '' }) }))
    expect(refused.availability).toBe('loginExpired')
  })
})

describe('DeepSeek', () => {
  it('reads the balance as a number and never as zero when absent', () => {
    const r = parseDeepSeekBalance(fixture('deepseek-balance'))
    expect(r.balance).toEqual({ amount: 42.3, currency: 'CNY' })
    expect(parseDeepSeekBalance({ balance_infos: [{ currency: 'CNY' }] }).availability).toBe('noLimitsReported')
  })

  it('prefers CNY when two currencies come back', () => {
    expect(parseDeepSeekBalance(fixture('deepseek-two-currencies')).balance).toEqual({ amount: 42.3, currency: 'CNY' })
  })

  it('maps a refused key', async () => {
    const r = await deepseek.fetch(ctx({ secret: 'k', http: async () => ({ status: 401, text: '' }) }))
    expect(r.availability).toBe('keyRefused')
    expect((await deepseek.fetch(ctx())).availability).toBe('notConnected')
  })
})

import type { UsageWindow } from '@shared/types'
import { type AdapterResult, type ProviderAdapter, isRecord, num, parseJson, statusToAvailability } from './types'

/**
 * GitHub Copilot's quotas, from the endpoint its own editor plugins use.
 * `GET api.github.com/copilot_internal/user` with a GitHub OAuth token as
 * `Authorization: token …` (Bearer is refused) and the editor headers the
 * plugins send. Not a public API; it can change without notice.
 *
 * The reply reports what is LEFT: `percent_remaining` at 90 means 10% spent.
 * The inversion happens here so everything downstream counts what is gone.
 */
const ENDPOINT = 'https://api.github.com/copilot_internal/user'

const LANES = [
  { key: 'premium_interactions', scope: 'Premium requests' },
  { key: 'chat', scope: 'Chat' },
  { key: 'completions', scope: 'Completions' }
] as const

function parseResetDate(value: unknown): number | null {
  if (typeof value !== 'string') return null
  // Older replies give a bare 2026-10-01; treat it as UTC midnight.
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value)
  return Number.isFinite(ms) ? ms : null
}

function lane(snapshot: Record<string, unknown>, key: string, scope: string, resets: number | null): UsageWindow | null {
  const entitlement = num(snapshot.entitlement) ?? 0
  const unlimited = snapshot.unlimited === true
  const hasQuota = typeof snapshot.has_quota === 'boolean' ? snapshot.has_quota : null

  // A quota the plan does not include arrives as has_quota:false with
  // percent_remaining 0, which read literally is a full red ring for
  // something the account never had. Drop it.
  if (hasQuota === false) return null
  // Older replies omit the flag: a lane excluded by the plan reads 100%
  // remaining with nothing issued. A lane you have run out of must stay.
  if (hasQuota === null && !unlimited && entitlement <= 0 && (num(snapshot.remaining) ?? 0) <= 0 && (num(snapshot.percent_remaining) ?? 0) >= 100) {
    return null
  }
  // Unlimited lanes have no share to show.
  const percentRemaining = num(snapshot.percent_remaining)
  if (unlimited || percentRemaining === null) return null

  const overageAllowed = snapshot.overage_permitted === true
  const tokenBased = snapshot.token_based_billing === true
  const creditsUsed = num(snapshot.credits_used)

  let usedFraction = Math.min(Math.max((100 - percentRemaining) / 100, 0), 1)
  let amounts: UsageWindow['amounts'] = null
  let over = 0

  if (tokenBased && entitlement > 0 && creditsUsed !== null) {
    // Credit billing: the counts are exact and can run past the allowance, so
    // the fraction is not clamped here (the ring clamps what it draws).
    usedFraction = creditsUsed / entitlement
    amounts = { used: creditsUsed, limit: entitlement, unit: 'credits' }
    over = Math.max(creditsUsed - entitlement, 0)
  } else if (entitlement > 0 && num(snapshot.remaining) !== null) {
    const remaining = num(snapshot.remaining) as number
    amounts = { used: Math.max(entitlement - remaining, 0), limit: entitlement, unit: 'requests' }
    over = Math.max(num(snapshot.overage_count) ?? 0, -remaining, 0)
  }

  const extra = num(snapshot.overage_entitlement)
  return {
    id: `copilot.${key}`,
    kind: 'monthly',
    scope,
    usedFraction,
    // Not a stated length: a calendar month is 28 to 31 days, so the clock arc
    // must not divide by it.
    windowSeconds: null,
    resetsAt: resets,
    // Spent is not the same as over the allowance: a lane with overage
    // permitted keeps working and is billed for it.
    isExhausted: percentRemaining <= 0 && !overageAllowed,
    amounts,
    overage: over > 0 || overageAllowed ? { over: Math.round(over * 10) / 10, allowed: overageAllowed, limit: extra !== null && extra > 0 ? extra : null } : null
  }
}

const titleCase = (text: string): string => text.replace(/[_-]+/g, ' ').replace(/(^| )([a-z])/g, (_m, sp: string, c: string) => sp + c.toUpperCase())

/**
 * The plan lives in two fields. `copilot_plan` says "individual_pro" for both
 * Pro and Pro+; the "+" is only in `access_type_sku` ("plus_monthly_...").
 */
export function copilotPlanName(plan: unknown, sku?: unknown): string | null {
  const raw = typeof plan === 'string' ? plan.trim() : ''
  const sk = typeof sku === 'string' ? sku.trim().toLowerCase() : ''
  if (raw === '' && sk === '') return null
  const p = raw.toLowerCase()
  if (sk.includes('plus')) return 'Pro+'
  if (sk.includes('free')) return 'Free'
  switch (p) {
    case 'individual_pro': return 'Pro'
    case 'individual_pro_plus': return 'Pro+'
    case 'individual': return 'Individual'
    case 'free': return 'Free'
    case 'business': return 'Business'
    case 'enterprise': return 'Enterprise'
    case '': return null
    default: return titleCase(raw)
  }
}

export function parseCopilotUsage(root: Record<string, unknown>): AdapterResult {
  const snapshots = isRecord(root.quota_snapshots) ? root.quota_snapshots : {}
  const resets = parseResetDate(root.quota_reset_date_utc) ?? parseResetDate(root.quota_reset_date)
  const windows: UsageWindow[] = []
  for (const l of LANES) {
    const node = snapshots[l.key]
    if (!isRecord(node)) continue
    const w = lane(node, l.key, l.scope, resets)
    if (w) windows.push(w)
  }
  return {
    availability: windows.length === 0 ? 'noLimitsReported' : 'live',
    windows,
    plan: copilotPlanName(root.copilot_plan, root.access_type_sku),
    source: 'GitHub Copilot usage endpoint'
  }
}

export const copilot: ProviderAdapter = {
  id: 'copilot',
  async fetch(ctx) {
    if (!ctx.secret) return { availability: 'notConnected' }
    let response
    try {
      response = await ctx.http(ENDPOINT, {
        headers: {
          Authorization: `token ${ctx.secret}`,
          Accept: 'application/json',
          'X-Github-Api-Version': '2025-04-01',
          // It answers a plugin, so it is asked as one.
          'Editor-Version': 'vscode/1.96.2',
          'Editor-Plugin-Version': 'copilot-chat/0.26.7'
        },
        timeoutMs: 15_000
      })
    } catch {
      return { availability: 'unreachable' }
    }
    if (response.status === 401 || response.status === 403) return { availability: 'signInRequired' }
    if (response.status !== 200) return { availability: statusToAvailability(response.status) }
    const root = parseJson(response.text)
    if (!root) return { availability: 'unreadableReply' }
    return parseCopilotUsage(root)
  }
}

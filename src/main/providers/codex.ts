import type { UsageWindow } from '@shared/types'
import { type AdapterResult, type FetchContext, type ProviderAdapter, isRecord, num, parseJson, statusToAvailability } from './types'

/**
 * Codex. Reads the OAuth credentials Codex already stored in auth.json and
 * asks the endpoint its own client calls. Not a public API. The token is not
 * renewed here; Codex refreshes it while you use Codex.
 */
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

export function codexAuthPath(ctx: Pick<FetchContext, 'homeDir' | 'env'>): string {
  const dir = ctx.env.CODEX_HOME?.trim() || `${ctx.homeDir}\\.codex`
  return `${dir}\\auth.json`
}

function kindForSeconds(seconds: number): UsageWindow['kind'] {
  if (seconds === 18_000) return 'fiveHour'
  if (seconds === 604_800) return 'weekly'
  return 'other'
}

function groupSpent(limit: Record<string, unknown>): boolean {
  return limit.limit_reached === true || limit.allowed === false
}

function windowsFrom(limit: Record<string, unknown>, idPrefix: string, scope: string | null): UsageWindow[] {
  const out: UsageWindow[] = []
  for (const slot of ['primary_window', 'secondary_window']) {
    const node = limit[slot]
    if (!isRecord(node)) continue
    const percent = num(node.used_percent)
    if (percent === null) continue
    const seconds = num(node.limit_window_seconds)
    const reset = num(node.reset_at)
    out.push({
      id: `${idPrefix}.${slot}`,
      kind: seconds === null ? 'other' : kindForSeconds(seconds),
      scope,
      usedFraction: percent / 100,
      windowSeconds: seconds,
      resetsAt: reset === null ? null : reset * 1000,
      isExhausted: false
    })
  }
  return out
}

/** Codex says "limit reached" for a whole group; pin it to the fullest window. */
function markSpent(windows: UsageWindow[], spent: boolean): UsageWindow[] {
  if (!spent || windows.length === 0) return windows
  let fullest = 0
  windows.forEach((w, i) => {
    if ((w.usedFraction ?? 0) > (windows[fullest].usedFraction ?? 0)) fullest = i
  })
  return windows.map((w, i) => (i === fullest ? { ...w, isExhausted: true } : w))
}

export function codexPlanName(raw: string): string {
  switch (raw.toLowerCase()) {
    case 'free': return 'Free'
    case 'go': return 'Go'
    case 'plus': return 'Plus'
    case 'pro': return 'Pro'
    case 'prolite': return 'Pro 5x'
    case 'team': return 'Team'
    case 'business': return 'Business'
    case 'enterprise': return 'Enterprise'
    case 'edu': return 'Edu'
    default: return raw
  }
}

function creditBalance(node: unknown): string | null {
  if (!isRecord(node) || node.unlimited === true) return null
  const value = num(node.balance)
  if (value === null) return typeof node.balance === 'string' ? node.balance : null
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}

export function parseCodexUsage(root: Record<string, unknown>): AdapterResult {
  let windows: UsageWindow[] = []
  const spendReached = isRecord(root.spend_control) && root.spend_control.reached === true
  const reachedType = root.rate_limit_reached_type !== undefined && root.rate_limit_reached_type !== null

  if (isRecord(root.rate_limit)) {
    windows = windows.concat(markSpent(windowsFrom(root.rate_limit, 'codex', null), groupSpent(root.rate_limit) || reachedType || spendReached))
  }
  const extras = Array.isArray(root.additional_rate_limits) ? root.additional_rate_limits : []
  for (const extra of extras) {
    if (!isRecord(extra) || !isRecord(extra.rate_limit)) continue
    const label = typeof extra.limit_name === 'string' ? extra.limit_name : null
    const key = typeof extra.metered_feature === 'string' ? extra.metered_feature : (label ?? 'extra')
    windows = windows.concat(markSpent(windowsFrom(extra.rate_limit, key, label), groupSpent(extra.rate_limit)))
  }

  return {
    availability: windows.length === 0 ? 'noLimitsReported' : 'live',
    windows,
    plan: typeof root.plan_type === 'string' ? codexPlanName(root.plan_type) : null,
    creditBalance: creditBalance(root.credits),
    source: 'Codex usage endpoint'
  }
}

export const codex: ProviderAdapter = {
  id: 'codex',
  async fetch(ctx) {
    const raw = ctx.readFile(codexAuthPath(ctx))
    if (raw === null) return { availability: 'notConnected' }
    const auth = parseJson(raw)
    const tokens = auth && isRecord(auth.tokens) ? auth.tokens : null
    const token = tokens && typeof tokens.access_token === 'string' ? tokens.access_token : null
    if (!token) return { availability: 'signInRequired' }
    const accountId = tokens && typeof tokens.account_id === 'string' ? tokens.account_id : null

    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    // Sent only when known: an empty header names no account.
    if (accountId) headers['ChatGPT-Account-Id'] = accountId

    let response
    try {
      response = await ctx.http(USAGE_URL, { headers, timeoutMs: 20_000 })
    } catch {
      return { availability: 'unreachable' }
    }
    if (response.status === 401 || response.status === 403) return { availability: 'loginExpired' }
    if (response.status !== 200) return { availability: statusToAvailability(response.status) }
    const root = parseJson(response.text)
    if (!root) return { availability: 'unreadableReply' }
    return parseCodexUsage(root)
  }
}

import type { UsageWindow } from '@shared/types'
import { type AdapterResult, type FetchContext, type ProviderAdapter, isRecord, isoToMs, num, parseJson, statusToAvailability } from './types'

/**
 * Claude Code. Reads the OAuth token Claude Code itself stored and asks the
 * same usage endpoint it does. Not a public API; it can change without notice.
 * Nothing here renews the token: it lives about five hours, and renewing a
 * copied one would rotate the refresh token the CLI relies on.
 */
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile'

const HEADERS = {
  'anthropic-beta': 'oauth-2025-04-20',
  'User-Agent': 'claude-cli (external, cli)',
  Accept: 'application/json'
}

export function claudeCredentialsPath(ctx: Pick<FetchContext, 'homeDir' | 'env'>): string {
  const dir = ctx.env.CLAUDE_CONFIG_DIR?.trim() || `${ctx.homeDir}\\.claude`
  return `${dir}\\.credentials.json`
}

/** Severity is the provider's judgement; `warning` still has room. */
function isSpentLimit(limit: Record<string, unknown>): boolean {
  if (limit.locked_reason !== undefined && limit.locked_reason !== null) return true
  const severity = typeof limit.severity === 'string' ? limit.severity.toLowerCase() : null
  if (severity === null) return false
  return !['normal', 'ok', 'none', 'healthy', 'warning', 'warn'].includes(severity)
}

export function parseClaudeUsage(root: Record<string, unknown>, plan: string | null): AdapterResult {
  const windows: UsageWindow[] = []

  const limits = Array.isArray(root.limits) ? root.limits : []
  for (const raw of limits) {
    if (!isRecord(raw)) continue
    const kind = raw.kind
    const percent = num(raw.percent)
    if (typeof kind !== 'string' || percent === null) continue
    let windowKind: UsageWindow['kind']
    let seconds: number
    if (kind === 'session') {
      windowKind = 'fiveHour'
      seconds = 5 * 3600
    } else if (kind === 'weekly_all' || kind === 'weekly_scoped') {
      windowKind = 'weekly'
      seconds = 7 * 86_400
    } else continue
    const scopeNode = isRecord(raw.scope) && isRecord(raw.scope.model) ? raw.scope.model : null
    const scope = scopeNode && typeof scopeNode.display_name === 'string' ? scopeNode.display_name : null
    windows.push({
      id: `claudeCode.${kind}.${scope ?? 'all'}`,
      kind: windowKind,
      scope,
      usedFraction: percent / 100,
      windowSeconds: seconds,
      resetsAt: isoToMs(raw.resets_at),
      isExhausted: isSpentLimit(raw)
    })
  }

  if (windows.length === 0) {
    for (const [key, kind, seconds] of [
      ['five_hour', 'fiveHour', 5 * 3600],
      ['seven_day', 'weekly', 7 * 86_400]
    ] as const) {
      const node = root[key]
      if (!isRecord(node)) continue
      const percent = num(node.utilization)
      if (percent === null) continue
      windows.push({
        id: `claudeCode.${key}`,
        kind,
        scope: null,
        usedFraction: percent / 100,
        windowSeconds: seconds,
        resetsAt: isoToMs(node.resets_at),
        isExhausted: isSpentLimit(node)
      })
    }
  }

  return {
    availability: windows.length === 0 ? 'noLimitsReported' : 'live',
    windows,
    plan,
    source: 'Claude Code usage endpoint'
  }
}

export function claudePlanName(profile: Record<string, unknown>): string | null {
  const sub = typeof profile.subscription_type === 'string' ? profile.subscription_type : null
  const org = isRecord(profile.organization) ? profile.organization : null
  const tier = org && typeof org.rate_limit_tier === 'string' ? org.rate_limit_tier : null
  const raw = tier?.toLowerCase().match(/max_(\d+)x/) ? tier : (sub ?? tier)
  if (!raw) return null
  const lower = raw.toLowerCase()
  const multiplier = lower.match(/max_(\d+)x/)
  if (multiplier) return `Max ${multiplier[1]}x`
  if (lower === 'claude_max' || lower === 'max') return 'Max'
  if (lower === 'claude_pro' || lower === 'pro') return 'Pro'
  if (lower === 'free') return 'Free'
  if (lower === 'team') return 'Team'
  if (lower === 'enterprise') return 'Enterprise'
  return raw.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const PLAN_TTL = 6 * 3600 * 1000
let planCache: { name: string | null; at: number } | null = null

export function resetClaudePlanCache(): void {
  planCache = null
}

export const claudeCode: ProviderAdapter = {
  id: 'claudeCode',
  async fetch(ctx) {
    const raw = ctx.readFile(claudeCredentialsPath(ctx))
    if (raw === null) return { availability: 'notConnected' }
    const creds = parseJson(raw)
    const oauth = creds && isRecord(creds.claudeAiOauth) ? creds.claudeAiOauth : null
    const token = oauth && typeof oauth.accessToken === 'string' ? oauth.accessToken : null
    if (!token) return { availability: 'signInRequired' }
    const expiresAt = oauth ? num(oauth.expiresAt) : null
    if (expiresAt !== null && expiresAt <= ctx.now) return { availability: 'loginExpired' }

    let response
    try {
      response = await ctx.http(USAGE_URL, {
        headers: { ...HEADERS, Authorization: `Bearer ${token}` },
        timeoutMs: 20_000
      })
    } catch {
      return { availability: 'unreachable' }
    }
    if (response.status === 401 || response.status === 403) return { availability: 'loginExpired' }
    if (response.status !== 200) return { availability: statusToAvailability(response.status) }
    const root = parseJson(response.text)
    if (!root) return { availability: 'unreadableReply' }

    let plan = planCache && ctx.now - planCache.at < PLAN_TTL ? planCache.name : null
    if (!planCache || ctx.now - planCache.at >= PLAN_TTL) {
      try {
        const profile = await ctx.http(PROFILE_URL, { headers: { ...HEADERS, Authorization: `Bearer ${token}` }, timeoutMs: 8_000 })
        const body = profile.status === 200 ? parseJson(profile.text) : null
        plan = body ? claudePlanName(body) : null
      } catch {
        plan = null
      }
      // A failure is cached too, so the plan never costs a retry every pass.
      planCache = { name: plan, at: ctx.now }
    }
    return parseClaudeUsage(root, plan)
  }
}

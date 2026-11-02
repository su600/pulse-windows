import type { Balance } from '@shared/types'
import { type AdapterResult, type ProviderAdapter, isRecord, num, parseJson, statusToAvailability } from './types'

/**
 * DeepSeek's prepaid balance. `GET /user/balance` is documented in DeepSeek's
 * own API reference. Every figure is a string; an absent or unparseable field
 * is absent, never zero (a balance read as zero would be a full red ring).
 */
const ENDPOINT = 'https://api.deepseek.com/user/balance'

export function parseDeepSeekBalance(root: Record<string, unknown>): AdapterResult {
  const infos = Array.isArray(root.balance_infos) ? root.balance_infos : []
  const balances: Balance[] = []
  for (const info of infos) {
    if (!isRecord(info)) continue
    const total = num(info.total_balance)
    const currency = typeof info.currency === 'string' ? info.currency : null
    if (total === null || currency === null) continue
    balances.push({ amount: total, currency })
  }
  if (balances.length === 0) return { availability: 'noLimitsReported' }
  // CNY first, then whatever the account holds.
  const preferred = balances.find((b) => b.currency === 'CNY') ?? balances[0]
  return { availability: 'live', balance: preferred, windows: [], source: 'DeepSeek balance endpoint' }
}

export const deepseek: ProviderAdapter = {
  id: 'deepseek',
  async fetch(ctx) {
    if (!ctx.secret) return { availability: 'notConnected' }
    let response
    try {
      response = await ctx.http(ENDPOINT, {
        headers: { Authorization: `Bearer ${ctx.secret}`, Accept: 'application/json' },
        timeoutMs: 15_000
      })
    } catch {
      return { availability: 'unreachable' }
    }
    if (response.status === 401 || response.status === 403) return { availability: 'keyRefused' }
    if (response.status !== 200) return { availability: statusToAvailability(response.status) }
    const root = parseJson(response.text)
    if (!root) return { availability: 'unreadableReply' }
    return parseDeepSeekBalance(root)
  }
}

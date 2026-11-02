import type { Availability, Balance, ProviderId, UsageWindow } from '@shared/types'

export interface HttpRequest {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export interface HttpResponse {
  status: number
  text: string
}

/** Throws on a network failure; resolves with any HTTP status. */
export type HttpFn = (url: string, init?: HttpRequest) => Promise<HttpResponse>

export interface FetchContext {
  http: HttpFn
  now: number
  /** The user's home directory (injected so tests need no real files). */
  homeDir: string
  env: Record<string, string | undefined>
  /** Reads a file as UTF-8, or null when it does not exist / cannot be read. */
  readFile: (path: string) => string | null
  /** A stored secret for this provider (API key, Copilot token). */
  secret: string | null
}

/** What an adapter returns; the coordinator fills in ids and timestamps. */
export interface AdapterResult {
  availability: Availability
  windows?: UsageWindow[]
  plan?: string | null
  creditBalance?: string | null
  balance?: Balance | null
  source?: string | null
}

export interface ProviderAdapter {
  id: ProviderId
  fetch(ctx: FetchContext): Promise<AdapterResult>
}

export function statusToAvailability(status: number): Availability {
  if (status === 401 || status === 403) return 'signInRequired'
  if (status === 429) return 'rateLimited'
  return 'serverError'
}

export function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isoToMs(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

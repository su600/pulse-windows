import type { ProviderId } from '@shared/types'
import { claudeCode } from './claudeCode'
import { codex } from './codex'
import { copilot } from './copilot'
import { deepseek } from './deepseek'
import { demoAdapter } from './demo'
import type { ProviderAdapter } from './types'

const ADAPTERS: Partial<Record<ProviderId, ProviderAdapter>> = { copilot, claudeCode, codex, deepseek }

export function adapterFor(id: ProviderId): ProviderAdapter {
  if (id.startsWith('demo')) return demoAdapter(id)
  const found = ADAPTERS[id]
  if (!found) throw new Error(`No adapter for ${id}`)
  return found
}

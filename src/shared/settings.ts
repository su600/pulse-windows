import {
  type AccountSettings,
  type AppSettings,
  DEFAULT_ACCOUNT,
  DEFAULT_SETTINGS,
  DEMO_PROVIDERS,
  PROVIDERS,
  type ProviderId
} from './types'
import type { DeepPartial } from './ipc'

const KNOWN_IDS = new Set<string>([...PROVIDERS, ...DEMO_PROVIDERS].map((p) => p.id))

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}
function numIn(value: unknown, lo: number, hi: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, lo), hi) : fallback
}

function sanitizeAccount(raw: unknown): AccountSettings {
  const o = isObj(raw) ? raw : {}
  const tint = typeof o.ringTint === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.ringTint) ? o.ringTint.toUpperCase() : null
  return {
    pinnedWindow: typeof o.pinnedWindow === 'string' ? o.pinnedWindow : null,
    ringTint: tint,
    detailedCard: bool(o.detailedCard, DEFAULT_ACCOUNT.detailedCard)
  }
}

/**
 * Turns anything read from disk or sent by a renderer into a valid
 * AppSettings. Unknown fields are dropped, bad values fall back to defaults,
 * and — importantly — a blank or damaged file yields "setup not done" with
 * nothing enabled, never "everything on".
 */
export function sanitizeSettings(raw: unknown): AppSettings {
  const d = DEFAULT_SETTINGS
  if (!isObj(raw) || raw.version !== 1) return structuredClone(d)

  const p = isObj(raw.panel) ? raw.panel : {}
  const free = isObj(p.free) && typeof p.free.x === 'number' && typeof p.free.y === 'number' ? { x: p.free.x, y: p.free.y } : null
  const enabledRaw = Array.isArray(raw.enabled) ? raw.enabled : []
  const enabled: ProviderId[] = []
  for (const id of enabledRaw) {
    if (typeof id === 'string' && KNOWN_IDS.has(id) && !enabled.includes(id as ProviderId)) enabled.push(id as ProviderId)
  }

  const accounts: AppSettings['accounts'] = {}
  if (isObj(raw.accounts)) {
    for (const [id, value] of Object.entries(raw.accounts)) {
      if (KNOWN_IDS.has(id)) accounts[id as ProviderId] = sanitizeAccount(value)
    }
  }

  const n = isObj(raw.notifications) ? raw.notifications : {}
  const net = isObj(raw.network) ? raw.network : {}
  const refresh = isObj(raw.refresh) ? raw.refresh : {}
  const warnAt = numIn(n.warnAt, 0, 0.95, 0)

  return {
    version: 1,
    setupDone: bool(raw.setupDone, false),
    enabled,
    language: oneOf(raw.language, ['system', 'en', 'zh-CN'] as const, d.language),
    panel: {
      visible: bool(p.visible, d.panel.visible),
      size: oneOf(p.size, ['small', 'standard', 'large'] as const, d.panel.size),
      spacing: oneOf(p.spacing, ['tight', 'standard', 'loose'] as const, d.panel.spacing),
      position: oneOf(p.position, ['left', 'right', 'free'] as const, d.panel.position),
      free,
      displayId: typeof p.displayId === 'number' && Number.isInteger(p.displayId) ? p.displayId : null,
      ratio: numIn(p.ratio, 0, 1, d.panel.ratio),
      autoCollapse: bool(p.autoCollapse, d.panel.autoCollapse),
      snapToEdges: bool(p.snapToEdges, d.panel.snapToEdges),
      lightPanel: bool(p.lightPanel, d.panel.lightPanel),
      showPercentages: bool(p.showPercentages, d.panel.showPercentages),
      showsRemaining: bool(p.showsRemaining, d.panel.showsRemaining),
      warningThreshold: numIn(p.warningThreshold, 0.6, 0.9, d.panel.warningThreshold),
      dockAlertColor: bool(p.dockAlertColor, d.panel.dockAlertColor),
      showWindowClock: bool(p.showWindowClock, d.panel.showWindowClock),
      animateActivity: bool(p.animateActivity, d.panel.animateActivity),
      barStyle: oneOf(p.barStyle, ['continuous', 'segmented'] as const, d.panel.barStyle),
      followActiveDisplay: bool(p.followActiveDisplay, d.panel.followActiveDisplay)
    },
    accounts,
    refresh: { seconds: numIn(refresh.seconds, 120, 1800, d.refresh.seconds) },
    notifications: {
      warnAt: warnAt > 0 && warnAt < 0.5 ? 0.5 : warnAt,
      onExhausted: bool(n.onExhausted, false),
      onReset: bool(n.onReset, false),
      onFailure: bool(n.onFailure, false)
    },
    launchAtLogin: bool(raw.launchAtLogin, false),
    network: {
      mode: oneOf(net.mode, ['system', 'none', 'manual'] as const, d.network.mode),
      host: typeof net.host === 'string' ? net.host.trim().slice(0, 253) : '',
      port: Math.round(numIn(net.port, 0, 65535, 0))
    }
  }
}

/** Applies a (validated) patch over current settings, field by field. */
export function applyPatch(current: AppSettings, patch: DeepPartial<AppSettings>): AppSettings {
  const merged = mergeDeep(structuredClone(current) as unknown as Record<string, unknown>, patch as unknown as Record<string, unknown>)
  // `version` is never patchable; sanitising re-validates every field.
  return sanitizeSettings({ ...merged, version: 1 })
}

function mergeDeep(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    // `free`, `enabled` and per-account entries replace wholesale.
    if (isObj(value) && isObj(target[key]) && key !== 'free') {
      target[key] = mergeDeep(target[key] as Record<string, unknown>, value)
    } else {
      target[key] = value
    }
  }
  return target
}

export function accountSettings(settings: AppSettings, id: ProviderId): AccountSettings {
  return settings.accounts[id] ?? DEFAULT_ACCOUNT
}

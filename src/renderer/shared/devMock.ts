import { computeFrame, metricsFor } from '@shared/layout'
import type { CopilotStatus, PanelLayoutMessage, PulseApi } from '@shared/ipc'
import { resolveLocale } from '@shared/i18n'
import { applyPatch, sanitizeSettings } from '@shared/settings'
import {
  type AppSettings,
  DEFAULT_SETTINGS,
  DEMO_PROVIDERS,
  type PanelState,
  type ProviderId,
  type SettingsState,
  type UsageSnapshot,
  providerInfo
} from '@shared/types'
import { parseCopilotUsage } from '../../main/providers/copilot'
import { parseClaudeUsage } from '../../main/providers/claudeCode'
import { parseDeepSeekBalance } from '../../main/providers/deepseek'
import copilotFixture from '../../../tests/fixtures/copilot-normal.json'
import deepseekFixture from '../../../tests/fixtures/deepseek-balance.json'

/**
 * Browser-only stand-in for the Electron main process, so the renderers can be
 * developed and previewed in a plain browser (npm run dev:web). It is compiled
 * out of production builds and never runs inside Electron.
 *
 *   ?mock=demo   six demo rings (default for panel.html)
 *   ?mock=real   Copilot, Claude Code and DeepSeek with fixture data
 *   ?mock=setup  first-run state (nothing chosen)
 *   ?pos=left|right|free   rail placement, ?collapse=1 to auto-collapse
 */
export function installDevMock(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined' || (window as { pulse?: unknown }).pulse) return

  const q = new URLSearchParams(location.search)
  const mode = q.get('mock') ?? (location.pathname.includes('panel') ? 'demo' : 'real')
  const now = Date.now()

  let settings: AppSettings = sanitizeSettings(null)
  if (mode === 'demo') settings = { ...settings, setupDone: true, enabled: DEMO_PROVIDERS.map((p) => p.id) }
  else if (mode === 'real') settings = { ...settings, setupDone: true, enabled: ['copilot', 'claudeCode', 'deepseek'] }
  const lang = q.get('lang')
  if (lang === 'zh-CN' || lang === 'en') settings = { ...settings, language: lang }
  const pos = q.get('pos')
  settings = {
    ...settings,
    panel: {
      ...settings.panel,
      position: pos === 'left' || pos === 'free' ? pos : 'right',
      autoCollapse: q.get('collapse') === '1',
      lightPanel: q.get('light') === '1',
      size: (q.get('size') as AppSettings['panel']['size']) ?? DEFAULT_SETTINGS.panel.size,
      barStyle: q.get('bars') === 'segmented' ? 'segmented' : 'continuous',
      free: { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    }
  }
  const claudeSample = {
    limits: [
      { kind: 'session', percent: 34, resets_at: new Date(now + 2.5 * 3600_000).toISOString() },
      { kind: 'weekly_all', percent: 62, resets_at: new Date(now + 3 * 86_400_000).toISOString() },
      { kind: 'weekly_scoped', percent: 81, resets_at: new Date(now + 3 * 86_400_000).toISOString(), scope: { model: { display_name: 'Opus' } } }
    ]
  }

  const snapshotFor = (id: ProviderId): UsageSnapshot => {
    const base: UsageSnapshot = {
      accountId: id, providerId: id, availability: 'live', windows: [], plan: null, creditBalance: null, balance: null,
      observedAt: now - 3 * 60_000, staleReason: null, origin: 'live', source: 'Mock'
    }
    if (id.startsWith('demo')) return { ...base, ...syncDemo(id, now) }
    if (id === 'copilot') return { ...base, ...parseCopilotUsage(copilotFixture as Record<string, unknown>), availability: 'live' } as UsageSnapshot
    if (id === 'claudeCode') return { ...base, ...parseClaudeUsage(claudeSample, 'Max 5x') } as UsageSnapshot
    if (id === 'deepseek') return { ...base, ...parseDeepSeekBalance(deepseekFixture as Record<string, unknown>) } as UsageSnapshot
    return base
  }

  const locale = (): 'en' | 'zh-CN' => resolveLocale(settings.language, navigator.language)
  const entries = (): PanelState['entries'] =>
    (settings.setupDone ? settings.enabled : []).map((id) => ({
      providerId: id, name: providerInfo(id).name, icon: providerInfo(id).icon, snapshot: snapshotFor(id), isRefreshing: false
    }))

  // ---- subscriptions
  const panelState = new Set<(s: PanelState) => void>()
  const layoutSubs = new Set<(l: PanelLayoutMessage) => void>()
  const pointerSubs = new Set<(p: { x: number; y: number } | null) => void>()
  const settingsSubs = new Set<(s: SettingsState) => void>()
  const copilotSubs = new Set<(s: CopilotStatus) => void>()
  let copilot: CopilotStatus = { phase: 'idle' }
  let signedIn = false

  const pState = (): PanelState => ({ settings, entries: entries(), now: Date.now(), locale: locale() })
  const sState = (): SettingsState => ({
    settings, entries: entries(), locale: locale(), version: '0.1.0-dev', now: Date.now(),
    detected: { claudeCode: true, codex: true, copilot: false },
    hasKey: { copilot: signedIn, deepseek: true },
    diagnostics: Object.fromEntries(settings.enabled.map((id) => [id, { at: now - 120_000, providerId: id, outcome: 'live', source: 'Mock', note: null }]))
  })
  const layout = (): PanelLayoutMessage => {
    const m = metricsFor(settings)
    const { panel, frame } = computeFrame({
      m, count: Math.max(entries().length, 1), showsPercentages: settings.panel.showPercentages,
      detailedCards: Object.values(settings.accounts).some((a) => a?.detailedCard),
      position: settings.panel.position, workArea: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
      ratio: settings.panel.ratio, free: settings.panel.free
    })
    // The real window sits at frame.x/y on screen; the browser page IS the screen.
    const shifted = { ...panel, rail: { ...panel.rail, x: panel.rail.x + frame.x, y: panel.rail.y + frame.y }, width: window.innerWidth, height: window.innerHeight }
    return { frame: shifted, docked: settings.panel.position === 'free' ? null : settings.panel.position, pointer: null, menuOpen: false, dragging: false }
  }
  const pushAll = (): void => {
    panelState.forEach((cb) => cb(pState()))
    layoutSubs.forEach((cb) => cb(layout()))
    settingsSubs.forEach((cb) => cb(sState()))
  }
  const commit = (next: AppSettings): void => {
    settings = next
    pushAll()
  }

  window.addEventListener('mousemove', (e) => pointerSubs.forEach((cb) => cb({ x: e.clientX, y: e.clientY })))
  document.addEventListener('mouseleave', () => pointerSubs.forEach((cb) => cb(null)))
  window.addEventListener('resize', pushAll)
  document.documentElement.style.background = location.pathname.includes('panel') ? '#f4f4f4' : ''
  document.body.style.background = location.pathname.includes('panel') ? '#f4f4f4' : ''

  const sub = <T,>(set: Set<(v: T) => void>) => (cb: (v: T) => void) => {
    set.add(cb)
    return () => { set.delete(cb) }
  }

  const api: PulseApi = {
    onPanelState: sub(panelState),
    onPanelLayout: sub(layoutSubs),
    onPointer: sub(pointerSubs),
    panelReady: () => setTimeout(pushAll, 0),
    setHitRects: () => {},
    dragStart: () => {},
    dragEnd: () => {},
    refreshAccount: (id) => console.info('[mock] refresh', id),
    panelContextMenu: () => console.info('[mock] context menu'),
    getSettingsState: async () => sState(),
    onSettingsState: sub(settingsSubs),
    patchSettings: (patch) => commit(applyPatch(settings, patch)),
    setEnabled: (ids) => commit(applyPatch(settings, { enabled: ids })),
    completeSetup: (ids) => commit(applyPatch(settings, { setupDone: true, enabled: ids })),
    refreshAll: () => console.info('[mock] refresh all'),
    saveSecret: async () => true,
    clearSecret: (id) => { if (id === 'copilot') signedIn = false; pushAll() },
    copilotStart: () => {
      copilot = { phase: 'waiting', prompt: { userCode: 'WDJB-MJHT', verificationUrl: 'https://github.com/login/device' } }
      copilotSubs.forEach((cb) => cb(copilot))
    },
    copilotCancel: () => { copilot = { phase: 'idle' }; copilotSubs.forEach((cb) => cb(copilot)) },
    onCopilotStatus: sub(copilotSubs),
    copilotStatus: async () => copilot,
    openExternal: (url) => console.info('[mock] open', url),
    copyText: (text) => console.info('[mock] copy', text),
    testNotification: () => console.info('[mock] notification'),
    closeWindow: () => {}
  }
  ;(window as unknown as { pulse: PulseApi }).pulse = api
}

function syncDemo(id: ProviderId, now: number): Partial<UsageSnapshot> {
  const table: Record<string, { used: number[]; titles?: Array<string | null>; plan: string }> = {
    demo1: { used: [0.06, 0.12], titles: ['Sonnet', null], plan: 'Max 5x' },
    demo2: { used: [0.89], plan: 'Pro' },
    demo3: { used: [0.02, 0], titles: ['Cursor Models', 'Other Models'], plan: 'Pro' },
    demo4: { used: [0.01], plan: 'Core' },
    demo5: { used: [0.22], plan: 'Pro+' },
    demo6: { used: [0.15], plan: 'Plus' }
  }
  const r = table[id]
  return {
    plan: r.plan,
    windows: r.used.map((u, i) => ({
      id: `${id}.${i}`, kind: 'monthly' as const, scope: r.titles?.[i] ?? null, usedFraction: u, windowSeconds: null,
      resetsAt: now + (8 + i * 3) * 86_400_000, isExhausted: false
    }))
  }
}

// Domain model shared by the main process and both renderers.
// Times are epoch milliseconds. `null` means "not reported", never zero.

export type WindowKind =
  | 'fiveHour'
  | 'weekly'
  | 'monthly'
  | 'daily'
  | 'spend'
  | 'balance'
  | 'credits'
  | 'other'

export interface UsageWindow {
  id: string
  kind: WindowKind
  /** Model group the limit applies to; null for an account-wide limit. */
  scope: string | null
  /** 0...1+ as the provider reported it; null when no fraction is known. */
  usedFraction: number | null
  /** Length of the window if the provider reported one. Drives the clock arc. */
  windowSeconds: number | null
  resetsAt: number | null
  /** The provider's own word that the limit is spent (may be < 100%). */
  isExhausted: boolean
}

/** Why a snapshot has no live figures. A state, not an error string. */
export type Availability =
  | 'live'
  | 'loading'
  | 'notConnected'
  | 'signInRequired'
  | 'loginExpired'
  | 'keyRefused'
  | 'rateLimited'
  | 'unreachable'
  | 'serverError'
  | 'unreadableReply'
  | 'noLimitsReported'

export interface Balance {
  amount: number
  currency: string
}

export interface UsageSnapshot {
  accountId: string
  providerId: ProviderId
  availability: Availability
  windows: UsageWindow[]
  plan: string | null
  /** Credit balance as a display string (Codex credits). */
  creditBalance: string | null
  /** Prepaid money balance (API providers). */
  balance: Balance | null
  observedAt: number
  /** Why the figures are stale (set only when origin is 'cache'). */
  staleReason: Availability | null
  /** `cache` marks last-good data shown while a refresh failed. */
  origin: 'live' | 'cache'
  /** Allow-listed note about where the figures came from. No secrets. */
  source: string | null
}

export type ProviderId = 'copilot' | 'claudeCode' | 'codex' | 'deepseek' | 'demo1' | 'demo2' | 'demo3' | 'demo4' | 'demo5' | 'demo6'

export type Billing = 'subscription' | 'api'

export interface ProviderInfo {
  id: ProviderId
  name: string
  /** Basename of the SVG in resources/icons, without extension. */
  icon: string
  billing: Billing
  /** How the figures are read. */
  credential: 'cli' | 'apiKey' | 'signIn' | 'demo'
  /** Path (relative to the home dir) whose presence marks "detected". */
  detectPath: string | null
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'copilot', name: 'GitHub Copilot', icon: 'github', billing: 'subscription', credential: 'signIn', detectPath: null },
  { id: 'claudeCode', name: 'Claude Code', icon: 'claude', billing: 'subscription', credential: 'cli', detectPath: '.claude' },
  { id: 'codex', name: 'Codex', icon: 'openai', billing: 'subscription', credential: 'cli', detectPath: '.codex' },
  { id: 'deepseek', name: 'DeepSeek', icon: 'deepseek', billing: 'api', credential: 'apiKey', detectPath: null }
]

export const DEMO_PROVIDERS: ProviderInfo[] = [
  { id: 'demo1', name: 'Claude Code', icon: 'claude', billing: 'subscription', credential: 'demo', detectPath: null },
  { id: 'demo2', name: 'Codex', icon: 'openai', billing: 'subscription', credential: 'demo', detectPath: null },
  { id: 'demo3', name: 'Cursor', icon: 'cursor', billing: 'subscription', credential: 'demo', detectPath: null },
  { id: 'demo4', name: 'Devin', icon: 'devin', billing: 'subscription', credential: 'demo', detectPath: null },
  { id: 'demo5', name: 'Kiro', icon: 'kiro', billing: 'subscription', credential: 'demo', detectPath: null },
  { id: 'demo6', name: 'Antigravity', icon: 'antigravity', billing: 'subscription', credential: 'demo', detectPath: null }
]

export function providerInfo(id: ProviderId): ProviderInfo {
  const found = [...PROVIDERS, ...DEMO_PROVIDERS].find((p) => p.id === id)
  if (!found) throw new Error(`Unknown provider ${id}`)
  return found
}

// ---------------------------------------------------------------- settings

export type PanelSize = 'small' | 'standard' | 'large'
export type PanelSpacing = 'tight' | 'standard' | 'loose'
export type PanelPosition = 'left' | 'right' | 'free'
export type BarStyle = 'continuous' | 'segmented'
export type LanguageSetting = 'system' | 'en' | 'zh-CN'
export type ProxyMode = 'system' | 'none' | 'manual'

export interface AccountSettings {
  /** Pinned window id for the ring; null = the fullest one. */
  pinnedWindow: string | null
  /** "#RRGGBB" ring colour chosen by the user; null = colour by usage. */
  ringTint: string | null
  detailedCard: boolean
}

export interface AppSettings {
  version: 1
  /** False until the first-run chooser is completed. Nothing is read before. */
  setupDone: boolean
  /** Enabled accounts in rail order. An account id is the provider id. */
  enabled: ProviderId[]
  language: LanguageSetting
  panel: {
    visible: boolean
    size: PanelSize
    spacing: PanelSpacing
    position: PanelPosition
    /** Rail centre in screen DIPs when position === 'free'. */
    free: { x: number; y: number } | null
    /** Electron display id the rail lives on; null = primary. */
    displayId: number | null
    /** Vertical placement 0..1 along the docked edge. */
    ratio: number
    autoCollapse: boolean
    snapToEdges: boolean
    lightPanel: boolean
    showPercentages: boolean
    showsRemaining: boolean
    warningThreshold: number
    dockAlertColor: boolean
    showWindowClock: boolean
    animateActivity: boolean
    barStyle: BarStyle
    followActiveDisplay: boolean
  }
  accounts: Partial<Record<ProviderId, AccountSettings>>
  refresh: { seconds: number }
  notifications: {
    /** Warn at this used fraction (0.5..0.95); 0 = off. */
    warnAt: number
    onExhausted: boolean
    onReset: boolean
    onFailure: boolean
  }
  launchAtLogin: boolean
  network: { mode: ProxyMode; host: string; port: number }
}

export const DEFAULT_ACCOUNT: AccountSettings = { pinnedWindow: null, ringTint: null, detailedCard: false }

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  setupDone: false,
  enabled: [],
  language: 'system',
  panel: {
    visible: true,
    size: 'standard',
    spacing: 'standard',
    position: 'right',
    free: null,
    displayId: null,
    ratio: 0.5,
    autoCollapse: true,
    snapToEdges: true,
    lightPanel: false,
    showPercentages: true,
    showsRemaining: false,
    warningThreshold: 0.75,
    dockAlertColor: true,
    showWindowClock: false,
    animateActivity: true,
    barStyle: 'continuous',
    followActiveDisplay: false
  },
  accounts: {},
  refresh: { seconds: 300 },
  notifications: { warnAt: 0, onExhausted: false, onReset: false, onFailure: false },
  launchAtLogin: false,
  network: { mode: 'system', host: '', port: 0 }
}

// ---------------------------------------------------------------- state sent to renderers

export interface RailEntry {
  providerId: ProviderId
  name: string
  icon: string
  snapshot: UsageSnapshot
  isRefreshing: boolean
}

export interface PanelState {
  settings: AppSettings
  entries: RailEntry[]
  /** Active display work-area size, for the card to know its room. */
  now: number
  locale: 'en' | 'zh-CN'
}

export interface Detected {
  [id: string]: boolean
}

export interface DiagnosticLine {
  at: number
  providerId: ProviderId
  outcome: Availability
  source: string | null
  note: string | null
}

export interface SettingsState {
  settings: AppSettings
  entries: RailEntry[]
  detected: Detected
  hasKey: Partial<Record<ProviderId, boolean>>
  diagnostics: Partial<Record<ProviderId, DiagnosticLine>>
  locale: 'en' | 'zh-CN'
  version: string
  now: number
}

import { BrowserWindow, Menu, Notification, Tray, app, clipboard, ipcMain, nativeImage, nativeTheme, powerMonitor, shell } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { type AlertMemory, evaluateAlerts, type AlertEvent } from '@shared/alerts'
import { windowTitle } from '@shared/format'
import { type Locale, resolveLocale, translator } from '@shared/i18n'
import type { CopilotStatus, DeepPartial } from '@shared/ipc'
import { effectiveSnapshot } from '@shared/rules'
import { applyPatch, sanitizeSettings } from '@shared/settings'
import {
  type AppSettings,
  DEMO_PROVIDERS,
  PROVIDERS,
  type PanelState,
  type ProviderId,
  type SettingsState,
  type UsageSnapshot,
  providerInfo
} from '@shared/types'
import { RefreshCoordinator } from './coordinator'
import { dlog, installCrashHandlers } from './log'
import { applyProxy, http } from './http'
import { PanelController } from './panel'
import { adapterFor } from './providers'
import { DeviceLoginError, awaitDeviceToken, startDeviceLogin, type DevicePrompt } from './providers/copilotLogin'
import type { FetchContext } from './providers/types'
import {
  clearSecret,
  getSecret,
  hasSecret,
  loadAlertMemory,
  loadSettings,
  loadSnapshots,
  saveAlertMemory,
  saveSettings,
  saveSnapshots,
  secretsAvailable,
  setSecret
} from './store'

const DEMO = process.env.PULSE_DEMO === '1'
if (DEMO) app.setPath('userData', join(app.getPath('userData'), '..', 'Pulse-demo'))

app.setAppUserModelId('io.github.pulse.windows')
const gotLock = app.requestSingleInstanceLock()
installCrashHandlers()
dlog(`start v${app.getVersion()} electron ${process.versions.electron} packaged=${app.isPackaged} lock=${gotLock}`)
if (!gotLock) {
  dlog('another Pulse is already running; this one quits (the running one opens Settings)')
  app.quit()
}

// ------------------------------------------------------------------ state

let settings: AppSettings = DEMO ? demoSettings() : loadSettings()
let alertMemory: AlertMemory = loadAlertMemory()
let panel: PanelController | null = null
let settingsWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
const diagnostics: SettingsState['diagnostics'] = {}
let copilotStatus: CopilotStatus = { phase: 'idle' }
let copilotAbort: AbortController | null = null

function demoSettings(): AppSettings {
  const base = sanitizeSettings(null)
  return { ...base, setupDone: true, enabled: DEMO_PROVIDERS.map((p) => p.id), panel: { ...base.panel, autoCollapse: false } }
}

const locale = (): Locale => resolveLocale(settings.language, app.getLocale())
const t = (key: Parameters<ReturnType<typeof translator>>[0], params?: Record<string, string | number>): string => translator(locale())(key, params)

// ------------------------------------------------------------------ data

const coordinator = new RefreshCoordinator({
  now: () => Date.now(),
  run: async (id) => {
    const ctx: FetchContext = {
      http,
      now: Date.now(),
      homeDir: homedir(),
      env: process.env,
      readFile: (path) => {
        try {
          return existsSync(path) ? readFileSync(path, 'utf8') : null
        } catch {
          return null
        }
      },
      secret: providerInfo(id).credential === 'cli' || providerInfo(id).credential === 'demo' ? null : getSecret(id)
    }
    return adapterFor(id).fetch(ctx)
  },
  initial: DEMO ? {} : loadSnapshots(),
  persist: (snapshots) => {
    if (!DEMO) saveSnapshots(snapshots)
  },
  onSnapshot: (snapshot) => {
    diagnostics[snapshot.providerId] = {
      at: snapshot.observedAt,
      providerId: snapshot.providerId,
      outcome: snapshot.availability,
      source: snapshot.source,
      note: null
    }
    runAlerts(snapshot)
  },
  onChange: () => broadcast()
})

function runAlerts(snapshot: UsageSnapshot): void {
  const { events, memory } = evaluateAlerts(alertMemory, snapshot, settings.notifications)
  alertMemory = memory
  if (!DEMO) saveAlertMemory(memory)
  for (const event of events) notify(event)
}

function notify(event: AlertEvent): void {
  if (!Notification.isSupported()) return
  const name = providerInfo(event.providerId).name
  const snap = coordinator.snapshotFor(event.providerId)
  const limitName = (): string => {
    if (event.kind === 'failure') return ''
    const w = snap?.windows.find((x) => x.id === event.windowId)
    return w ? windowTitle(w, t) : t('win.limit')
  }
  let title: string
  let body: string
  switch (event.kind) {
    case 'warn':
      title = t('note.warn', { name, pct: event.percent })
      body = t('note.warnBody', { limit: limitName(), pct: event.percent })
      break
    case 'exhausted':
      title = t('note.exhausted', { name })
      body = t('note.exhaustedBody', { limit: limitName() })
      break
    case 'reset':
      title = t('note.reset', { name })
      body = t('note.resetBody', { limit: limitName() })
      break
    case 'failure':
      title = t('note.failure', { name })
      body = t('note.failureBody')
      break
  }
  new Notification({ title, body, silent: false }).show()
}

/** Nothing is shown or read before the first-run choice is made. */
function activeIds(s: AppSettings): ProviderId[] {
  return s.setupDone ? s.enabled : []
}

function buildEntries(): PanelState['entries'] {
  const now = Date.now()
  const refreshing = coordinator.refreshing
  return activeIds(settings).map((id) => {
    const info = providerInfo(id)
    const raw = coordinator.snapshotFor(id)
    const snapshot = effectiveSnapshot(raw ?? { ...emptyLoading(id, now) }, now)
    return { providerId: id, name: info.name, icon: info.icon, snapshot, isRefreshing: refreshing.has(id) }
  })
}

function emptyLoading(id: ProviderId, now: number): UsageSnapshot {
  return { accountId: id, providerId: id, availability: 'loading', windows: [], plan: null, creditBalance: null, balance: null, observedAt: now, staleReason: null, origin: 'live', source: null }
}

function panelState(): PanelState {
  return { settings, entries: buildEntries(), now: Date.now(), locale: locale() }
}

function settingsState(): SettingsState {
  const detected: SettingsState['detected'] = {}
  for (const p of PROVIDERS) detected[p.id] = p.detectPath !== null && existsSync(join(homedir(), p.detectPath))
  const hasKey: SettingsState['hasKey'] = {}
  for (const p of PROVIDERS) if (p.credential !== 'cli') hasKey[p.id] = hasSecret(p.id)
  return {
    settings,
    entries: buildEntries(),
    detected,
    hasKey,
    diagnostics,
    locale: locale(),
    version: app.getVersion(),
    now: Date.now()
  }
}

let broadcastTimer: ReturnType<typeof setTimeout> | null = null
function broadcast(): void {
  // Coalesce bursts (several accounts answering together) into one send.
  if (broadcastTimer) return
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null
    panel?.pushState()
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('settings:state', settingsState())
    updateTray()
    syncPanelVisibility()
  }, 16)
}

function syncPanelVisibility(): void {
  if (!panel) return
  const shouldShow = settings.panel.visible && activeIds(settings).length > 0
  if (shouldShow && !panel.win.isVisible()) panel.show()
  else if (!shouldShow && panel.win.isVisible()) panel.hide()
}

// ------------------------------------------------------------------ settings

function commit(next: AppSettings): void {
  const prev = settings
  settings = next
  if (!DEMO) saveSettings(next)

  if (JSON.stringify(activeIds(prev)) !== JSON.stringify(activeIds(next))) coordinator.setEnabled(activeIds(next))
  if (prev.refresh.seconds !== next.refresh.seconds) coordinator.setInterval(next.refresh.seconds)
  if (JSON.stringify(prev.network) !== JSON.stringify(next.network)) void applyProxy(next.network)
  if (prev.launchAtLogin !== next.launchAtLogin) app.setLoginItemSettings({ openAtLogin: next.launchAtLogin })
  if (prev.language !== next.language) rebuildTrayMenu()
  panel?.relayout()
  broadcast()
}

function patchSettings(patch: DeepPartial<AppSettings>): void {
  commit(applyPatch(settings, patch))
}

/** Position changes during a drag are recorded in memory; written when it ends. */
let placementSaveTimer: ReturnType<typeof setTimeout> | null = null
function recordPlacement(patch: Partial<AppSettings['panel']>): void {
  settings = { ...settings, panel: { ...settings.panel, ...patch } }
  if (placementSaveTimer) clearTimeout(placementSaveTimer)
  placementSaveTimer = setTimeout(() => {
    if (!DEMO) saveSettings(settings)
    broadcast()
  }, 400)
}

// ------------------------------------------------------------------ windows

function rendererUrl(page: 'panel' | 'settings', query = ''): string | { file: string } {
  if (process.env.ELECTRON_RENDERER_URL) return `${process.env.ELECTRON_RENDERER_URL}/${page}.html${query}`
  return { file: join(__dirname, `../renderer/${page}.html`) }
}

function createPanel(): void {
  panel = new PanelController({
    settings: () => settings,
    ringCount: () => Math.max(activeIds(settings).length, 1),
    state: panelState,
    record: recordPlacement,
    menu: panelMenu
  })
  const url = rendererUrl('panel')
  panel.load(url)
}

function panelMenu(): Electron.MenuItemConstructorOptions[] {
  return [
    { label: t('menu.settings'), click: () => openSettings() },
    { label: t('menu.refresh'), click: () => void coordinator.refreshAll() },
    { type: 'separator' },
    { label: t('menu.show'), type: 'checkbox', checked: settings.panel.visible, click: () => patchSettings({ panel: { visible: !settings.panel.visible } }) },
    { type: 'separator' },
    { label: t('menu.quit'), click: () => app.quit() }
  ]
}

function openSettings(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show()
    settingsWindow.focus()
    return
  }
  settingsWindow = new BrowserWindow({
    width: 920,
    height: 660,
    minWidth: 720,
    minHeight: 460,
    show: false,
    title: t('set.title'),
    icon: app.isPackaged ? undefined : join(app.getAppPath(), 'build/icon.png'),
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  settingsWindow.setMenu(null)
  settingsWindow.webContents.on('will-navigate', (e) => e.preventDefault())
  settingsWindow.once('ready-to-show', () => {
    dlog('settings window ready-to-show')
    settingsWindow?.show()
  })
  settingsWindow.webContents.on('did-fail-load', (_e, code, description, url) => dlog(`settings did-fail-load ${code} ${description} ${url}`))
  settingsWindow.webContents.on('render-process-gone', (_e, details) => dlog(`settings render-process-gone ${details.reason}`))
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
  // Links open in the browser, never inside the app.
  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const url = rendererUrl('settings')
  if (typeof url === 'string') void settingsWindow.loadURL(url)
  else void settingsWindow.loadFile(url.file)
}

// ------------------------------------------------------------------ tray

function trayImage(): Electron.NativeImage {
  const name = nativeTheme.shouldUseDarkColors ? 'light' : 'dark'
  const file = app.isPackaged ? join(process.resourcesPath, `tray-${name}.png`) : join(app.getAppPath(), `resources/tray-${name}.png`)
  return nativeImage.createFromPath(file).resize({ width: 16, height: 16 })
}

function createTray(): void {
  tray = new Tray(trayImage())
  tray.on('click', () => openSettings())
  nativeTheme.on('updated', () => tray?.setImage(trayImage()))
  rebuildTrayMenu()
  updateTray()
}

function rebuildTrayMenu(): void {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate(panelMenu()))
}

function updateTray(): void {
  if (!tray) return
  const parts = buildEntries()
    .map((e) => {
      const w = e.snapshot.windows.reduce<number | null>((max, x) => Math.max(max ?? 0, x.usedFraction ?? 0), null)
      return w === null ? null : `${e.name} ${Math.round(Math.min(w, 1) * 100)}%`
    })
    .filter((x): x is string => x !== null)
  tray.setToolTip(parts.length ? `Pulse\n${parts.join('\n')}` : 'Pulse')
}

// ------------------------------------------------------------------ copilot sign-in

function setCopilotStatus(status: CopilotStatus): void {
  copilotStatus = status
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('copilot:status', status)
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })

async function startCopilotLogin(): Promise<void> {
  copilotAbort?.abort()
  if (!secretsAvailable()) {
    setCopilotStatus({ phase: 'failed', message: t('cp.noStorage') })
    return
  }
  const abort = new AbortController()
  copilotAbort = abort
  try {
    const prompt: DevicePrompt = await startDeviceLogin(http)
    if (abort.signal.aborted) return
    // The code goes on the clipboard; the link never carries it.
    clipboard.writeText(prompt.userCode)
    setCopilotStatus({ phase: 'waiting', prompt: { userCode: prompt.userCode, verificationUrl: prompt.verificationUrl } })
    void shell.openExternal(prompt.verificationUrl)
    const token = await awaitDeviceToken(http, prompt, abort.signal, sleep)
    if (abort.signal.aborted) return
    if (!setSecret('copilot', token)) throw new DeviceLoginError('refused', t('cp.noStorage'))
    setCopilotStatus({ phase: 'idle' })
    // A fresh token reads at once; a signed-in account that is shown refreshes.
    if (settings.enabled.includes('copilot')) void coordinator.refresh('copilot')
    broadcast()
  } catch (error) {
    if (abort.signal.aborted) {
      setCopilotStatus({ phase: 'idle' })
      return
    }
    const why = error instanceof Error ? error.message : String(error)
    setCopilotStatus({ phase: 'failed', message: t('cp.failed', { why }) })
  } finally {
    if (copilotAbort === abort) copilotAbort = null
  }
}

// ------------------------------------------------------------------ IPC

function registerIpc(): void {
  ipcMain.on('panel:ready', () => panel?.markReady())
  ipcMain.on('panel:hit-rects', (_e, rects) => panel?.setHitRects(Array.isArray(rects) ? rects : []))
  ipcMain.on('panel:drag-start', () => panel?.beginDrag())
  ipcMain.on('panel:drag-end', () => panel?.endDrag())
  ipcMain.on('panel:refresh-account', (_e, id: ProviderId) => void coordinator.refresh(id))
  ipcMain.on('panel:context-menu', () => panel?.popupMenu())

  ipcMain.handle('settings:get', () => settingsState())
  ipcMain.on('settings:patch', (_e, patch) => patchSettings(patch))
  ipcMain.on('settings:set-enabled', (_e, ids: ProviderId[]) => patchSettings({ enabled: ids }))
  ipcMain.on('settings:complete-setup', (_e, ids: ProviderId[]) => {
    patchSettings({ setupDone: true, enabled: ids })
    broadcast()
  })
  ipcMain.on('settings:refresh-all', () => void coordinator.refreshAll())
  ipcMain.on('settings:close', () => settingsWindow?.close())
  ipcMain.on('settings:test-notification', () => {
    if (Notification.isSupported()) new Notification({ title: 'Pulse', body: t('note.warnBody', { limit: t('win.weekly'), pct: 75 }) }).show()
  })

  ipcMain.handle('secret:save', (_e, id: ProviderId, value: string) => {
    if (typeof value !== 'string' || value.trim() === '' || providerInfo(id).credential !== 'apiKey') return false
    const ok = setSecret(id, value.trim())
    if (ok && settings.enabled.includes(id)) void coordinator.refresh(id)
    broadcast()
    return ok
  })
  ipcMain.on('secret:clear', (_e, id: ProviderId) => {
    clearSecret(id)
    if (settings.enabled.includes(id)) void coordinator.refresh(id)
    broadcast()
  })

  ipcMain.on('copilot:start', () => void startCopilotLogin())
  ipcMain.on('copilot:cancel', () => {
    copilotAbort?.abort()
    setCopilotStatus({ phase: 'idle' })
  })
  ipcMain.handle('copilot:status', () => copilotStatus)

  ipcMain.on('shell:open-external', (_e, url: string) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) void shell.openExternal(url)
  })
  ipcMain.on('shell:copy', (_e, text: string) => {
    if (typeof text === 'string' && text.length < 2000) clipboard.writeText(text)
  })
}

// ------------------------------------------------------------------ lifecycle

app.on('second-instance', () => openSettings())

app.whenReady().then(async () => {
  if (!gotLock) return
  dlog('ready')
  registerIpc()
  await applyProxy(settings.network)
  createPanel()
  dlog('panel created')
  createTray()
  dlog('tray created')

  // Nothing is read before the first-run choice has been made.
  coordinator.setInterval(settings.refresh.seconds)
  coordinator.setEnabled(activeIds(settings))
  coordinator.start()
  if (!settings.setupDone) openSettings()
  dlog(`settings window requested=${!settings.setupDone}; enabled=${activeIds(settings).length}; panelVisible=${settings.panel.visible}`)
  syncPanelVisibility()
  dlog(`panel visible=${panel?.win.isVisible()}`)

  powerMonitor.on('resume', () => setTimeout(() => void coordinator.refreshAll(), 5000))
  powerMonitor.on('unlock-screen', () => void coordinator.refreshAll())

  if (process.env.PULSE_SHOT && panel) {
    const { runShots } = await import('./debugShot')
    void runShots(panel, process.env.PULSE_SHOT, (process.env.PULSE_SHOT_HOVER ?? '1,2').split(',').map(Number), () => app.quit())
  }
})

// Closing windows must not quit: Pulse lives in the tray and on the edge.
app.on('window-all-closed', () => {
  /* keep running */
})
app.on('before-quit', () => {
  quitting = true
  coordinator.stop()
})
void quitting

import { contextBridge, ipcRenderer } from 'electron'
import type { CopilotStatus, PanelLayoutMessage, PulseApi } from '../shared/ipc'
import type { PanelState, SettingsState } from '../shared/types'

function listen<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: T): void => cb(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: PulseApi = {
  onPanelState: (cb) => listen<PanelState>('panel:state', cb),
  onPanelLayout: (cb) => listen<PanelLayoutMessage>('panel:layout', cb),
  onPointer: (cb) => listen('panel:pointer', cb),
  panelReady: () => ipcRenderer.send('panel:ready'),
  setHitRects: (rects) => ipcRenderer.send('panel:hit-rects', rects),
  dragStart: () => ipcRenderer.send('panel:drag-start'),
  dragEnd: () => ipcRenderer.send('panel:drag-end'),
  refreshAccount: (id) => ipcRenderer.send('panel:refresh-account', id),
  panelContextMenu: () => ipcRenderer.send('panel:context-menu'),

  getSettingsState: () => ipcRenderer.invoke('settings:get') as Promise<SettingsState>,
  onSettingsState: (cb) => listen<SettingsState>('settings:state', cb),
  patchSettings: (patch) => ipcRenderer.send('settings:patch', patch),
  setEnabled: (ids) => ipcRenderer.send('settings:set-enabled', ids),
  completeSetup: (ids) => ipcRenderer.send('settings:complete-setup', ids),
  refreshAll: () => ipcRenderer.send('settings:refresh-all'),
  saveSecret: (id, value) => ipcRenderer.invoke('secret:save', id, value) as Promise<boolean>,
  clearSecret: (id) => ipcRenderer.send('secret:clear', id),
  copilotStart: () => ipcRenderer.send('copilot:start'),
  copilotCancel: () => ipcRenderer.send('copilot:cancel'),
  onCopilotStatus: (cb) => listen<CopilotStatus>('copilot:status', cb),
  copilotStatus: () => ipcRenderer.invoke('copilot:status') as Promise<CopilotStatus>,
  openExternal: (url) => ipcRenderer.send('shell:open-external', url),
  copyText: (text) => ipcRenderer.send('shell:copy', text),
  testNotification: () => ipcRenderer.send('settings:test-notification'),
  closeWindow: () => ipcRenderer.send('settings:close')
}

contextBridge.exposeInMainWorld('pulse', api)

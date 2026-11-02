import type { PanelFrame } from './layout'
import type { AppSettings, PanelState, ProviderId, SettingsState } from './types'

/** Recursively partial, for settings patches. */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends Array<unknown> ? T[K] : DeepPartial<T[K]>) : T[K] }

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Sent to the panel renderer whenever the window frame or rail changes. */
export interface PanelLayoutMessage {
  frame: PanelFrame
  /** Whether the rail stands against a screen edge. */
  docked: 'left' | 'right' | null
  /** Pointer in window coordinates, or null when it is outside the window. */
  pointer: { x: number; y: number } | null
  /** The panel's context menu is open: keep the rail out. */
  menuOpen: boolean
  /** A drag is in progress: keep the rail out and the card closed. */
  dragging: boolean
}

export interface CopilotPrompt {
  userCode: string
  verificationUrl: string
}

export type CopilotStatus =
  | { phase: 'idle' }
  | { phase: 'waiting'; prompt: CopilotPrompt }
  | { phase: 'failed'; message: string }

export interface PulseApi {
  // ---- panel
  onPanelState(cb: (state: PanelState) => void): () => void
  onPanelLayout(cb: (layout: PanelLayoutMessage) => void): () => void
  onPointer(cb: (pointer: { x: number; y: number } | null) => void): () => void
  panelReady(): void
  /** Rectangles (window coordinates) that should receive the mouse. */
  setHitRects(rects: Rect[]): void
  dragStart(): void
  dragEnd(): void
  refreshAccount(id: ProviderId): void
  panelContextMenu(): void
  // ---- settings
  getSettingsState(): Promise<SettingsState>
  onSettingsState(cb: (state: SettingsState) => void): () => void
  patchSettings(patch: DeepPartial<AppSettings>): void
  setEnabled(ids: ProviderId[]): void
  completeSetup(ids: ProviderId[]): void
  refreshAll(): void
  saveSecret(id: ProviderId, value: string): Promise<boolean>
  clearSecret(id: ProviderId): void
  copilotStart(): void
  copilotCancel(): void
  onCopilotStatus(cb: (status: CopilotStatus) => void): () => void
  copilotStatus(): Promise<CopilotStatus>
  openExternal(url: string): void
  copyText(text: string): void
  testNotification(): void
  closeWindow(): void
}

declare global {
  interface Window {
    pulse: PulseApi
  }
}

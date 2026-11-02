import { BrowserWindow, Menu, screen, type Display } from 'electron'
import { join } from 'node:path'
import { DOCK_DISTANCE, clamp, computeFrame, metricsFor, ringCentre } from '@shared/layout'
import type { PanelFrame } from '@shared/layout'
import { dlog } from './log'
import type { PanelLayoutMessage, Rect } from '@shared/ipc'
import type { AppSettings, PanelState } from '@shared/types'

export interface PanelHost {
  settings(): AppSettings
  /** Number of rings the window must be budgeted for. */
  ringCount(): number
  state(): PanelState
  /** Persist a placement change (position, ratio, free, display). */
  record(patch: Partial<AppSettings['panel']>): void
  menu(): Electron.MenuItemConstructorOptions[]
}

const POLL_MS = 16

/**
 * The floating panel. One transparent, non-activating, always-on-top window.
 *
 * - Its size depends only on settings and the ring count, never on whether a
 *   card is open: the card is an overlay inside the window.
 * - The pointer is sampled here (not via DOM hover): the window is mostly
 *   transparent and never focused, so enter/leave events are unreliable.
 *   The same sample decides whether the window takes the mouse or lets it
 *   through to whatever is underneath.
 * - Dragging belongs to the window: the renderer says "pick up", and this
 *   follows the real cursor, docking to a side near an edge.
 */
export class PanelController {
  readonly win: BrowserWindow
  private panel: PanelFrame | null = null
  private docked: 'left' | 'right' | null = null
  private hitRects: Rect[] = []
  private ignoring = true
  private poll: ReturnType<typeof setInterval> | null = null
  private raise: ReturnType<typeof setInterval> | null = null
  private lastPointer: { x: number; y: number } | null | undefined = undefined
  private drag: { grab: { x: number; y: number } } | null = null
  private ready = false
  private menuOpen = false
  /** Test hook: when set, replaces the sampled pointer (screenshots). */
  debugPointer: { x: number; y: number } | null | undefined = undefined

  constructor(private readonly host: PanelHost) {
    this.win = new BrowserWindow({
      width: 400,
      height: 600,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })
    this.win.webContents.on('will-navigate', (e) => e.preventDefault())
    this.win.webContents.on('did-fail-load', (_e, code, description, url) => dlog(`panel did-fail-load ${code} ${description} ${url}`))
    this.win.webContents.on('render-process-gone', (_e, details) => dlog(`panel render-process-gone ${details.reason}`))
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.win.setAlwaysOnTop(true, 'screen-saver')
    this.win.setIgnoreMouseEvents(true, { forward: true })
    this.win.on('closed', () => this.stopTimers())
    screen.on('display-metrics-changed', () => this.relayout())
    screen.on('display-removed', () => this.relayout())
    screen.on('display-added', () => this.relayout())
  }

  load(url: string | { file: string }): void {
    if (typeof url === 'string') void this.win.loadURL(url)
    else void this.win.loadFile(url.file)
  }

  markReady(): void {
    this.ready = true
    this.relayout()
    this.pushState()
  }

  /** Centre of ring `index` in window coordinates (screenshots and tests). */
  ringPoint(index: number): { x: number; y: number } | null {
    if (!this.panel) return null
    const settings = this.host.settings()
    const c = ringCentre(metricsFor(settings), index, settings.panel.showPercentages, settings.panel.position !== 'free')
    return { x: this.panel.rail.x + c.x, y: this.panel.rail.y + c.y }
  }

  setHitRects(rects: Rect[]): void {
    this.hitRects = rects
  }

  show(): void {
    if (this.win.isDestroyed()) return
    this.relayout()
    this.win.showInactive()
    this.startTimers()
  }

  hide(): void {
    this.stopTimers()
    if (!this.win.isDestroyed()) this.win.hide()
  }

  pushState(): void {
    if (!this.ready || this.win.isDestroyed()) return
    this.win.webContents.send('panel:state', this.host.state())
  }

  // ------------------------------------------------------------ placement

  private display(): Display {
    const s = this.host.settings().panel
    if (s.followActiveDisplay && !this.drag) {
      return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    }
    const found = s.displayId === null ? undefined : screen.getAllDisplays().find((d) => d.id === s.displayId)
    return found ?? screen.getPrimaryDisplay()
  }

  /** Recomputes the window frame and tells the renderer. Never during a drag press-and-hold resize. */
  relayout(): void {
    if (this.win.isDestroyed()) return
    const settings = this.host.settings()
    const display = this.display()
    const m = metricsFor(settings)
    const { frame, panel } = computeFrame({
      m,
      count: this.host.ringCount(),
      showsPercentages: settings.panel.showPercentages,
      detailedCards: Object.values(settings.accounts).some((a) => a?.detailedCard),
      position: settings.panel.position,
      workArea: display.workArea,
      ratio: settings.panel.ratio,
      free: settings.panel.free
    })
    this.panel = panel
    this.docked = settings.panel.position === 'free' ? null : settings.panel.position
    const current = this.win.getBounds()
    if (current.x !== frame.x || current.y !== frame.y || current.width !== frame.width || current.height !== frame.height) {
      this.win.setBounds(frame, false)
    }
    this.sendLayout()
  }

  private sendLayout(): void {
    if (!this.ready || !this.panel || this.win.isDestroyed()) return
    const msg: PanelLayoutMessage = { frame: this.panel, docked: this.docked, pointer: this.lastPointer ?? null, menuOpen: this.menuOpen, dragging: this.drag !== null }
    this.win.webContents.send('panel:layout', msg)
  }

  // ------------------------------------------------------------ pointer

  private startTimers(): void {
    if (this.poll) return
    this.poll = setInterval(() => this.tick(), POLL_MS)
    // Topmost windows slip under the taskbar when it is activated.
    this.raise = setInterval(() => {
      if (!this.win.isDestroyed() && this.win.isVisible()) this.win.moveTop()
    }, 4000)
  }

  private stopTimers(): void {
    if (this.poll) clearInterval(this.poll)
    if (this.raise) clearInterval(this.raise)
    this.poll = null
    this.raise = null
  }

  private tick(): void {
    if (this.win.isDestroyed() || !this.win.isVisible()) return
    if (this.drag) {
      this.followDrag()
      return
    }
    const settings = this.host.settings()
    if (settings.panel.followActiveDisplay) {
      const active = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      if (active.id !== settings.panel.displayId) {
        this.host.record({ displayId: active.id })
        this.relayout()
      }
    }
    const cursor = screen.getCursorScreenPoint()
    const b = this.win.getBounds()
    const inWindow = cursor.x >= b.x && cursor.y >= b.y && cursor.x < b.x + b.width && cursor.y < b.y + b.height
    const sampled = inWindow ? { x: cursor.x - b.x, y: cursor.y - b.y } : null
    const pointer = this.debugPointer !== undefined ? this.debugPointer : sampled

    const over = pointer !== null && this.hitRects.some((r) => pointer.x >= r.x && pointer.x < r.x + r.width && pointer.y >= r.y && pointer.y < r.y + r.height)
    const shouldIgnore = !over
    if (shouldIgnore !== this.ignoring) {
      this.ignoring = shouldIgnore
      this.win.setIgnoreMouseEvents(shouldIgnore, { forward: true })
    }

    const prev = this.lastPointer
    const changed = (prev === null) !== (pointer === null) || prev === undefined || (pointer !== null && prev !== null && (prev.x !== pointer.x || prev.y !== pointer.y))
    if (changed) {
      this.lastPointer = pointer
      this.win.webContents.send('panel:pointer', pointer)
    }
  }

  // ------------------------------------------------------------ drag

  beginDrag(): void {
    if (!this.panel) return
    const cursor = screen.getCursorScreenPoint()
    const b = this.win.getBounds()
    const centre = { x: b.x + this.panel.rail.x + this.panel.rail.width / 2, y: b.y + this.panel.rail.y + this.panel.rail.height / 2 }
    this.drag = { grab: { x: cursor.x - centre.x, y: cursor.y - centre.y } }
    this.win.setIgnoreMouseEvents(false)
    this.ignoring = false
    this.sendLayout()
  }

  endDrag(): void {
    if (!this.drag) return
    this.drag = null
    this.lastPointer = undefined
    this.relayout()
  }

  private followDrag(): void {
    if (!this.drag || !this.panel) return
    const settings = this.host.settings()
    const cursor = screen.getCursorScreenPoint()
    // Clamp to the screen under the pointer, not the window's own screen,
    // or a second monitor is unreachable.
    const display = screen.getDisplayNearestPoint(cursor)
    const wa = display.workArea
    const m = metricsFor(settings)
    const railW = this.panel.rail.width
    const railH = this.panel.rail.height
    const centre = { x: cursor.x - this.drag.grab.x, y: cursor.y - this.drag.grab.y }

    const patch: Partial<AppSettings['panel']> = { displayId: display.id }
    if (settings.panel.snapToEdges) {
      const leftGap = centre.x - railW / 2 - wa.x
      const rightGap = wa.x + wa.width - (centre.x + railW / 2)
      if (leftGap <= DOCK_DISTANCE && leftGap <= rightGap) patch.position = 'left'
      else if (rightGap <= DOCK_DISTANCE) patch.position = 'right'
      else patch.position = 'free'
    } else {
      patch.position = 'free'
    }
    if (patch.position === 'free') {
      // Free rails stay at least DOCK_DISTANCE from the sides while snapping is
      // on, so a free rail never looks docked.
      const margin = settings.panel.snapToEdges ? DOCK_DISTANCE + railW / 2 : railW / 2
      patch.free = {
        x: clamp(centre.x, wa.x + margin, wa.x + wa.width - margin),
        y: clamp(centre.y, wa.y + railH / 2, wa.y + wa.height - railH / 2)
      }
    } else {
      patch.ratio = clamp((centre.y - wa.y) / wa.height, 0, 1)
    }
    void m
    this.host.record(patch)
    this.relayout()
  }

  // ------------------------------------------------------------ menu

  popupMenu(): void {
    const menu = Menu.buildFromTemplate(this.host.menu())
    // The menu runs its own loop; the rail must not wind down underneath it.
    this.menuOpen = true
    this.sendLayout()
    menu.popup({
      window: this.win,
      callback: () => {
        this.menuOpen = false
        this.lastPointer = undefined
        this.sendLayout()
      }
    })
  }
}

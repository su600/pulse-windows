import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PanelLayoutMessage, Rect } from '@shared/ipc'
import { itemLength, metricsFor, ringCentre } from '@shared/layout'
import { accountSettings } from '@shared/settings'
import { tintColor } from '@shared/rules'
import type { PanelState } from '@shared/types'
import { useNow } from '../shared/hooks'
import { Card } from './Card'
import { capsulePath, dockedRailPath } from './geometry'
import { Ring } from './Ring'
import { alertTint, ringView } from './view'

/** How long the rail must have been out before a ring click refreshes. */
const RING_CLICK_GUARD = 300
const CARD_GRACE = 320
const COLLAPSE_DELAY = 600
const DRAG_THRESHOLD = 4

const inRect = (p: { x: number; y: number } | null, r: Rect | null): boolean =>
  !!p && !!r && p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height

export function Panel() {
  const [state, setState] = useState<PanelState | null>(null)
  const [layout, setLayout] = useState<PanelLayoutMessage | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [hovered, setHovered] = useState(false)
  const [cardRect, setCardRect] = useState<Rect | null>(null)
  const now = useNow(30_000)

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const expandedAt = useRef(0)
  const press = useRef<{ x: number; y: number; idx: number; dragging: boolean } | null>(null)

  useEffect(() => {
    const offs = [
      window.pulse.onPanelState(setState),
      window.pulse.onPanelLayout((l) => {
        setLayout(l)
      }),
      window.pulse.onPointer(setPointer)
    ]
    window.pulse.panelReady()
    return () => offs.forEach((off) => off())
  }, [])

  const settings = state?.settings
  const entries = state?.entries ?? []
  const m = useMemo(() => (settings ? metricsFor(settings) : null), [settings])
  const rail = layout?.frame.rail
  const docks = layout?.docked ?? null
  const dragging = layout?.dragging ?? false
  const menuOpen = layout?.menuOpen ?? false

  const collapsed = !!settings && docks !== null && settings.panel.autoCollapse && !hovered && !menuOpen && !dragging

  // ------------------------------------------------------------ geometry

  const centres = useMemo(() => {
    if (!m || !settings || !rail) return []
    return entries.map((_, i) => {
      const c = ringCentre(m, i, settings.panel.showPercentages, docks !== null)
      return { x: rail.x + c.x, y: rail.y + c.y }
    })
  }, [m, settings, rail, entries.length, docks])

  /** Item boxes (ring + label), generous so the gaps do not flicker the card. */
  const slotAt = useCallback(
    (p: { x: number; y: number } | null): number => {
      if (!p || !m || !settings || !rail || collapsed) return -1
      if (p.x < rail.x || p.x >= rail.x + rail.width) return -1
      const len = itemLength(m, settings.panel.showPercentages)
      for (let i = 0; i < centres.length; i++) {
        const top = centres[i].y - m.ringDiameter / 2 - m.itemGap / 2
        if (p.y >= top && p.y < top + len + m.itemGap) return i
      }
      return -1
    },
    [m, settings, rail, centres, collapsed]
  )

  const sliverRect = useMemo((): Rect | null => {
    if (!m || !rail || docks === null) return null
    const hitW = m.collapsedHitWidth
    const y = rail.y + (rail.height - m.collapsedHeight) / 2
    const x = docks === 'right' ? rail.x + rail.width - hitW : rail.x
    return { x, y, width: hitW, height: m.collapsedHeight }
  }, [m, rail, docks])

  const railHit: Rect | null = rail ? (collapsed && sliverRect ? sliverRect : { x: rail.x, y: rail.y, width: rail.width, height: rail.height }) : null

  // ------------------------------------------------------------ pointer

  useEffect(() => {
    if (!settings) return
    const overRail = inRect(pointer, railHit)
    const overCard = inRect(pointer, cardRect)
    const idx = slotAt(pointer)

    if (overRail || overCard) {
      if (collapseTimer.current) clearTimeout(collapseTimer.current)
      collapseTimer.current = null
      if (!hovered) {
        expandedAt.current = performance.now()
        setHovered(true)
      }
    } else if (hovered && !collapseTimer.current) {
      collapseTimer.current = setTimeout(() => {
        collapseTimer.current = null
        setHovered(false)
      }, COLLAPSE_DELAY)
    }

    if (dragging || menuOpen) {
      setSelected(null)
      return
    }
    if (idx >= 0) {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hideTimer.current = null
      setSelected(idx)
    } else if (overCard) {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hideTimer.current = null
    } else if (selected !== null && !hideTimer.current) {
      hideTimer.current = setTimeout(() => {
        hideTimer.current = null
        setSelected(null)
      }, CARD_GRACE)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointer, cardRect, dragging, menuOpen, collapsed])

  // The window passes the mouse through everywhere except these rectangles.
  useEffect(() => {
    const rects: Rect[] = []
    if (railHit) rects.push(railHit)
    if (cardRect) rects.push(cardRect)
    window.pulse.setHitRects(rects)
  }, [railHit?.x, railHit?.y, railHit?.width, railHit?.height, cardRect?.x, cardRect?.y, cardRect?.width, cardRect?.height])

  // ------------------------------------------------------------ press / drag / click

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    press.current = { x: e.clientX, y: e.clientY, idx: slotAt({ x: e.clientX, y: e.clientY }), dragging: false }
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const p = press.current
    if (!p || p.dragging) return
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_THRESHOLD) {
      p.dragging = true
      window.pulse.dragStart()
    }
  }
  const endPress = (e: React.PointerEvent, cancelled: boolean): void => {
    const p = press.current
    press.current = null
    if (!p) return
    if (p.dragging) {
      window.pulse.dragEnd()
      return
    }
    // A click needs the rail to have been out a moment: a press that began on
    // whatever was under the pointer before the rings appeared is dropped.
    if (!cancelled && p.idx >= 0 && performance.now() - expandedAt.current >= RING_CLICK_GUARD) {
      const entry = entries[p.idx]
      if (entry) window.pulse.refreshAccount(entry.providerId)
    }
    void e
  }

  if (!state || !settings || !m || !layout || !rail) return null

  const light = settings.panel.lightPanel
  const fill = light ? '#F7F7F7' : '#000000'
  const edge = light ? 'rgba(0,0,0,0.12)' : 'transparent'
  const ink = light ? '#111111' : '#FFFFFF'
  const mirror = docks === 'left'
  const alert = settings.panel.dockAlertColor ? alertTint(entries, settings) : null
  const sliverFill = alert ? tintColor(alert, light) : fill
  const selectedEntry = selected !== null ? entries[selected] : undefined
  const showCard = !!selectedEntry && !collapsed && !dragging && !menuOpen
  const showPct = settings.panel.showPercentages

  return (
    <div className="panel-root" style={{ color: ink }} onContextMenu={(e) => { e.preventDefault(); window.pulse.panelContextMenu() }}>
      <div
        className="rail"
        style={{ left: rail.x, top: rail.y, width: rail.width, height: rail.height, pointerEvents: collapsed ? 'none' : 'auto' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPress(e, false)}
        onPointerCancel={(e) => endPress(e, true)}
      >
        <div
          className="rail-body"
          style={{
            opacity: collapsed ? 0 : 1,
            transform: collapsed ? `scaleX(${m.collapsedWidth / m.railWidth})` : 'scaleX(1)',
            transformOrigin: docks === 'left' ? 'left center' : docks === 'right' ? 'right center' : 'center'
          }}
        >
          <svg width={rail.width} height={rail.height} viewBox={`0 0 ${rail.width} ${rail.height}`} style={{ transform: mirror ? 'scaleX(-1)' : undefined }}>
            <path
              d={docks !== null ? dockedRailPath(rail.width, rail.height, m.flareWidth, m.flareHeight, m.cornerRadius) : capsulePath(rail.width, rail.height)}
              fill={fill}
              stroke={edge}
              strokeWidth={1}
            />
          </svg>
          {entries.map((entry, i) => {
            const view = ringView(entry, settings, now, state.locale)
            const c = centres[i]
            if (!c) return null
            const acct = accountSettings(settings, entry.providerId)
            void acct
            return (
              <div key={entry.providerId} className="item" style={{ left: c.x - rail.x - m.ringDiameter / 2, top: c.y - rail.y - m.ringDiameter / 2 }}>
                <Ring icon={entry.icon} view={view} m={m} light={light} highlight={selected === i} refreshing={entry.isRefreshing} animate={settings.panel.animateActivity} />
                {showPct && (
                  <div
                    className="pct"
                    style={{
                      top: m.ringDiameter + m.ringToText,
                      fontSize: m.percentFont,
                      width: m.railWidth,
                      left: (m.ringDiameter - m.railWidth) / 2,
                      color: view.spent ? tintColor('exhausted', light) : view.isOverageCost ? tintColor('warning', light) : undefined,
                      opacity: view.hasReading ? 1 : 0.5
                    }}
                  >
                    {view.label}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {docks !== null && (
        <div
          className="sliver"
          style={{
            left: docks === 'right' ? rail.x + rail.width - m.collapsedWidth : rail.x,
            top: rail.y + (rail.height - m.collapsedHeight) / 2,
            width: m.collapsedWidth,
            height: m.collapsedHeight,
            background: sliverFill,
            opacity: collapsed ? 1 : 0,
            borderRadius: docks === 'right' ? `${m.collapsedWidth}px 0 0 ${m.collapsedWidth}px` : `0 ${m.collapsedWidth}px ${m.collapsedWidth}px 0`,
            boxShadow: light ? 'inset 0 0 0 1px rgba(0,0,0,.12)' : 'inset 0 0 0 1px rgba(255,255,255,.14)'
          }}
        />
      )}

      {showCard && selectedEntry && centres[selected!] && (
        <Card
          entry={selectedEntry}
          settings={settings}
          m={m}
          locale={state.locale}
          now={now}
          light={light}
          detailed={accountSettings(settings, selectedEntry.providerId).detailedCard}
          side={layout.frame.cardSide}
          anchor={centres[selected!]}
          windowHeight={layout.frame.height}
          railEdge={layout.frame.cardSide === 'left' ? rail.x : rail.x + rail.width}
          onRect={setCardRect}
        />
      )}
    </div>
  )
}

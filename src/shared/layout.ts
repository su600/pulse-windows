import type { AppSettings, PanelPosition } from './types'

/**
 * Panel geometry, in DIPs. Ported from Pulse's `DockLayout` and
 * `DetailCardLayout` so the BrowserWindow frame and the drawn rail share one
 * budget: the window never changes size when a card opens, and measurements
 * are whole numbers (a fractional frame left the hit rect short of the edge).
 */

const SIZE_SCALE = { small: 0.82, standard: 1, large: 1.22 } as const
const SPACING_SCALE = { tight: 0.6, standard: 1, loose: 1.4 } as const

export interface Metrics {
  scale: number
  railWidth: number
  ringDiameter: number
  ringLine: number
  percentFont: number
  percentHeight: number
  ringToText: number
  itemGap: number
  endPadding: number
  flareWidth: number
  flareHeight: number
  cornerRadius: number
  collapsedWidth: number
  collapsedHeight: number
  collapsedHitWidth: number
  card: {
    width: number
    padding: number
    cornerRadius: number
    pointerWidth: number
    pointerHeight: number
    gap: number
    contentSpacing: number
    titleFont: number
    rowFont: number
    footFont: number
    barHeight: number
    rowHeight: number
    headerHeight: number
    iconSize: number
  }
}

export function metricsFor(settings: AppSettings): Metrics {
  const s = SIZE_SCALE[settings.panel.size]
  const spacing = SPACING_SCALE[settings.panel.spacing]
  const ringDiameter = 36 * s
  const ringLine = 4 * s
  const showsClock = settings.panel.showWindowClock
  const barHeight = (settings.panel.barStyle === 'segmented' ? 12 : 6) * s
  return {
    scale: s,
    railWidth: Math.ceil(64 * s),
    ringDiameter,
    ringLine,
    percentFont: 13 * s,
    percentHeight: Math.ceil(16 * s),
    ringToText: 6 * s + (showsClock ? 5 * s : 0),
    itemGap: 30 * s * spacing,
    endPadding: 46 * s,
    flareWidth: 38 * s,
    flareHeight: 24 * s,
    cornerRadius: 26 * s,
    collapsedWidth: 6 * s,
    collapsedHeight: 96 * s,
    collapsedHitWidth: 20 * s,
    card: {
      width: 250 * s,
      padding: 18 * s,
      cornerRadius: (ringDiameter + ringLine) / 2,
      pointerWidth: 20 * s,
      pointerHeight: 40 * s,
      gap: 8 * s,
      contentSpacing: 14 * s,
      titleFont: 14 * s,
      rowFont: 11.5 * s,
      footFont: 11 * s,
      barHeight,
      rowHeight: 14 * s + 7 * s + barHeight + 7 * s + 14 * s,
      headerHeight: 19 * s,
      iconSize: 16 * s
    }
  }
}

export function itemLength(m: Metrics, showsPercentages: boolean): number {
  return showsPercentages ? m.ringDiameter + m.ringToText + m.percentHeight : m.ringDiameter
}

/** Rail length (a vertical rail's height) for `count` rings, docked. */
export function railLength(m: Metrics, count: number, showsPercentages: boolean, docked: boolean): number {
  const n = Math.max(count, 1)
  const pad = docked ? m.endPadding : m.endPadding - m.flareHeight
  return Math.ceil(pad * 2 + itemLength(m, showsPercentages) * n + m.itemGap * (n - 1))
}

/** The tallest a detail card gets: header, six limits, a footnote. */
export function cardMaxHeight(m: Metrics, detailed: boolean): number {
  const c = m.card
  const extra = detailed ? 150 * m.scale : 0
  return Math.ceil(c.padding * 2 + c.headerHeight + 6 * (m.card.rowHeight + c.contentSpacing) + 14 * m.scale + extra)
}

export function cardHeight(m: Metrics, rows: number, opts: { detailed: boolean; footnote: boolean }): number {
  const c = m.card
  const header = c.headerHeight + (opts.detailed ? 4 * m.scale + 14 * m.scale : 0)
  const body = rows * c.rowHeight + Math.max(rows - 1, 0) * c.contentSpacing
  const foot = opts.footnote ? c.contentSpacing + 13 * m.scale : 0
  const extra = opts.detailed ? 150 * m.scale : 0
  return Math.ceil(c.padding * 2 + header + c.contentSpacing + Math.max(body, 18 * m.scale) + foot + extra)
}

export interface PanelFrame {
  /** Window size in DIPs. */
  width: number
  height: number
  /** Rail rectangle within the window. */
  rail: { x: number; y: number; width: number; height: number }
  /** Which side of the rail the card opens toward. */
  cardSide: 'left' | 'right'
}

export interface FrameInput {
  m: Metrics
  count: number
  showsPercentages: boolean
  detailedCards: boolean
  position: PanelPosition
  /** Work area of the display holding the rail. */
  workArea: { x: number; y: number; width: number; height: number }
  /** Rail centre along the screen, as a ratio down the work area (docked). */
  ratio: number
  /** Rail centre in screen DIPs (free). */
  free: { x: number; y: number } | null
}

/**
 * Window frame in screen coordinates plus the rail's offset inside it.
 * The frame fits the tallest card, not just the rail, so a card never gets
 * sliced against the window edge.
 */
export function computeFrame(input: FrameInput): { frame: { x: number; y: number; width: number; height: number }; panel: PanelFrame } {
  const { m, workArea } = input
  const docked = input.position !== 'free'
  const railH = railLength(m, input.count, input.showsPercentages, docked)
  const railW = m.railWidth
  const cardRoom = m.card.width + m.card.pointerWidth + m.card.gap
  const tall = Math.max(railH, cardMaxHeight(m, input.detailedCards))
  const height = Math.min(Math.ceil(tall), workArea.height)

  const railCentreY = docked
    ? workArea.y + workArea.height * clamp(input.ratio, 0, 1)
    : (input.free?.y ?? workArea.y + workArea.height / 2)
  const railTopWanted = railCentreY - railH / 2
  const railTopClamped = clamp(railTopWanted, workArea.y, workArea.y + workArea.height - railH)
  const top = clamp(railTopClamped + railH / 2 - height / 2, workArea.y, workArea.y + workArea.height - height)
  const railY = Math.round(railTopClamped - top)

  if (input.position === 'right') {
    const width = Math.ceil(cardRoom + railW)
    return {
      frame: { x: workArea.x + workArea.width - width, y: Math.round(top), width, height },
      panel: { width, height, rail: { x: width - railW, y: railY, width: railW, height: railH }, cardSide: 'left' }
    }
  }
  if (input.position === 'left') {
    const width = Math.ceil(cardRoom + railW)
    return {
      frame: { x: workArea.x, y: Math.round(top), width, height },
      panel: { width, height, rail: { x: 0, y: railY, width: railW, height: railH }, cardSide: 'right' }
    }
  }
  // Free: room for a card on either side; it opens toward the roomier half.
  const width = Math.ceil(cardRoom * 2 + railW)
  const cx = clamp(input.free?.x ?? workArea.x + workArea.width / 2, workArea.x + railW / 2, workArea.x + workArea.width - railW / 2)
  const left = Math.round(cx - width / 2)
  const onRightHalf = cx > workArea.x + workArea.width / 2
  return {
    frame: { x: left, y: Math.round(top), width, height },
    panel: {
      width,
      height,
      rail: { x: Math.round(width / 2 - railW / 2), y: railY, width: railW, height: railH },
      cardSide: onRightHalf ? 'left' : 'right'
    }
  }
}

/** Ring centre (relative to the rail) for slot `index`. */
export function ringCentre(m: Metrics, index: number, showsPercentages: boolean, docked: boolean): { x: number; y: number } {
  const pad = docked ? m.endPadding : m.endPadding - m.flareHeight
  const step = itemLength(m, showsPercentages) + m.itemGap
  return { x: m.railWidth / 2, y: pad + index * step + m.ringDiameter / 2 }
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi))
}

/** Distance (DIPs) from a screen edge within which a drag docks. */
export const DOCK_DISTANCE = 48

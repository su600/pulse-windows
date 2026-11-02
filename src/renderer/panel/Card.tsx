import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { amountLines, availabilityText, formatClock, formatReset, formatUpdated, windowTitle } from '@shared/format'
import type { Locale } from '@shared/i18n'
import type { Metrics } from '@shared/layout'
import { formatCompactMoney, isSpent, percentOf, tintColor, windowTint } from '@shared/rules'
import { providerInfo, type AppSettings, type RailEntry } from '@shared/types'
import { ProviderIcon } from '../shared/Icon'
import { useSpring, useT } from '../shared/hooks'
import { bubblePath } from './geometry'

interface Props {
  entry: RailEntry
  settings: AppSettings
  m: Metrics
  locale: Locale
  now: number
  light: boolean
  detailed: boolean
  side: 'left' | 'right'
  /** Ring centre in window coordinates; the pointer aims at it. */
  anchor: { x: number; y: number }
  /** The window's height: a taller card scrolls inside. */
  windowHeight: number
  railEdge: number
  onRect(rect: { x: number; y: number; width: number; height: number } | null): void
}

export function Card({ entry, settings, m, locale, now, light, detailed, side, anchor, windowHeight, railEdge, onRect }: Props) {
  const t = useT(locale)
  const c = m.card
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentH, setContentH] = useState(120 * m.scale)

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const measure = (): void => setContentH(el.scrollHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [entry.providerId])

  const height = Math.min(Math.ceil(contentH), windowHeight)
  const totalW = c.width + c.pointerWidth
  const wanted = anchor.y - height / 2
  const top = Math.min(Math.max(wanted, 0), Math.max(windowHeight - height, 0))
  const x = side === 'left' ? railEdge - c.gap - totalW : railEdge + c.gap
  // Springs: switching between rings sweeps the card instead of cutting.
  const springTop = useSpring(top, 0.28)
  const springH = useSpring(height, 0.28)
  const springPointer = useSpring(anchor.y - top, 0.28)

  useEffect(() => {
    onRect({ x, y: top, width: totalW, height })
    return () => onRect(null)
  }, [x, top, totalW, height, onRect])

  const { snapshot } = entry
  const ink = light ? '#111' : '#fff'
  const warn = settings.panel.warningThreshold
  const rows = snapshot.windows.map((w) => {
    const spent = isSpent(w)
    const used = w.usedFraction ?? 0
    const pct = percentOf(w.usedFraction, settings.panel.showsRemaining)
    return {
      id: w.id,
      title: windowTitle(w, t),
      fraction: settings.panel.showsRemaining && !spent ? 1 - Math.min(used, 1) : Math.min(used, 1),
      color: tintColor(windowTint(w, warn), light),
      ...amountLines(w, t, locale),
      spent,
      text: pct === null ? '–' : settings.panel.showsRemaining ? t('card.left', { pct }) : t('card.used', { pct }),
      reset: w.resetsAt ? t('card.resets', { when: formatReset(w.resetsAt, locale) }) : null
    }
  })

  const noData = rows.length === 0 && !snapshot.balance && !snapshot.creditBalance

  return (
    <div
      className="card"
      style={{ left: x, top: springTop, width: totalW, height: springH, color: ink, fontSize: c.rowFont }}
    >
      <svg className="card-shape" width={totalW} height={springH} viewBox={`0 0 ${totalW} ${springH}`} style={{ transform: side === 'right' ? 'scaleX(-1)' : undefined }}>
        <path d={bubblePath(totalW, springH, c.cornerRadius, c.pointerWidth, c.pointerHeight, springPointer)} fill={light ? '#F7F7F7' : '#000'} stroke={light ? 'rgba(0,0,0,.12)' : 'none'} strokeWidth={1} />
      </svg>
      <div
        ref={contentRef}
        className="card-content"
        style={{ left: side === 'left' ? 0 : c.pointerWidth, width: c.width, padding: c.padding, maxHeight: windowHeight }}
      >
        <div className="card-header">
          <ProviderIcon name={entry.icon} size={c.iconSize} />
          <span className="card-title" style={{ fontSize: c.titleFont }}>{t('card.usage', { name: entry.name })}</span>
          {detailed && snapshot.plan && <span className="card-plan" style={{ fontSize: c.footFont }}>{snapshot.plan}</span>}
        </div>
        {detailed && (
          <div className="card-updated" style={{ fontSize: c.footFont, paddingLeft: c.iconSize + 8 }}>
            {formatUpdated(snapshot.observedAt, now, t)}
          </div>
        )}

        <div className="card-rows" style={{ gap: c.contentSpacing, marginTop: c.contentSpacing }}>
          {rows.map((r) => (
            <div key={r.id} className="card-row" style={{ gap: 7 * m.scale }}>
              <div className="row-title">{r.title}</div>
              <Bar fraction={r.fraction} color={r.color} style={settings.panel.barStyle} height={c.barHeight} scale={m.scale} />
              <div className="row-line">
                <span className="row-used" style={{ color: r.spent ? tintColor('exhausted', light) : undefined }}>{r.text}</span>
                {r.reset && <span className="row-reset">{r.reset}</span>}
              </div>
              {r.amount && <div className="row-amount">{r.amount}</div>}
              {r.over && <div className="row-over" style={{ color: tintColor('warning', light) }}>{r.over}</div>}
            </div>
          ))}
          {snapshot.balance && (
            <div className="card-row" style={{ gap: 4 * m.scale }}>
              <div className="row-title">{t('card.balance')}</div>
              <div className="row-balance" style={{ fontSize: 20 * m.scale }}>{formatCompactMoney(snapshot.balance.amount, snapshot.balance.currency, locale)}</div>
            </div>
          )}
          {snapshot.creditBalance && (
            <div className="card-row" style={{ gap: 4 * m.scale }}>
              <div className="row-title">{t('card.creditBalance')}</div>
              <div className="row-line"><span className="row-used">{t('card.remaining', { amount: snapshot.creditBalance })}</span></div>
            </div>
          )}
          {noData && <div className="card-message" style={{ fontSize: 12 * m.scale }}>{availabilityText(snapshot.availability, t, providerInfo(entry.providerId))}</div>}
        </div>

        {snapshot.origin === 'cache' && snapshot.staleReason && (
          <div className="card-foot" style={{ fontSize: c.footFont, marginTop: c.contentSpacing }}>
            {t('card.asOf', { when: formatClock(snapshot.observedAt, locale) })} · {availabilityText(snapshot.staleReason, t, providerInfo(entry.providerId))}
          </div>
        )}
      </div>
    </div>
  )
}

function Bar({ fraction, color, style, height, scale }: { fraction: number; color: string; style: AppSettings['panel']['barStyle']; height: number; scale: number }) {
  if (style === 'continuous') {
    return (
      <div className="bar" style={{ height }}>
        <div className="bar-fill" style={{ width: `${Math.min(Math.max(fraction, 0), 1) * 100}%`, background: color }} />
      </div>
    )
  }
  return <SegmentedBar fraction={fraction} color={color} height={height} scale={scale} />
}

const TICK = 2.5
const GAP = 2

/** A row of thin ticks lit up to the fraction: at least one once a limit is touched, all only when spent. */
function SegmentedBar({ fraction, color, height, scale }: { fraction: number; color: string; height: number; scale: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(214)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    setWidth(el.clientWidth)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const step = (TICK + GAP) * scale
  const count = Math.max(Math.floor((width + GAP * scale) / step), 1)
  const clamped = Math.min(Math.max(fraction, 0), 1)
  let lit = Math.round(clamped * count)
  if (clamped > 0) lit = Math.max(lit, 1)
  if (clamped < 1) lit = Math.min(lit, count - 1)
  if (clamped >= 1) lit = count
  return (
    <div ref={ref} className="bar-ticks" style={{ height, gap: GAP * scale }}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} style={{ width: TICK * scale, background: i < lit ? color : 'currentColor', opacity: i < lit ? 1 : 0.17 }} />
      ))}
    </div>
  )
}

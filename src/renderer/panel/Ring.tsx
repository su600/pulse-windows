import type { Metrics } from '@shared/layout'
import { tintColor } from '@shared/rules'
import { ProviderIcon } from '../shared/Icon'
import type { RingView } from './view'

interface Props {
  icon: string
  view: RingView
  m: Metrics
  light: boolean
  highlight: boolean
  refreshing: boolean
  animate: boolean
}

/**
 * One ring: a gauge arc around the provider's mark. Colour says how close the
 * limit is; the icon says which service. The usage arc is never rotated (at 0%
 * there is no arc to see turning); a refresh draws a short travelling segment.
 */
export function Ring({ icon, view, m, light, highlight, refreshing, animate }: Props) {
  const D = m.ringDiameter
  const line = m.ringLine
  const r = (D - line) / 2
  const circumference = 2 * Math.PI * r
  const color = view.customColor ?? tintColor(view.tint, light)
  const centre = D - (line + 4 * m.scale) * 2
  const dash = circumference * view.arc
  const refreshDash = circumference * 0.16
  const busy = refreshing && animate

  return (
    <div className="ring" style={{ width: D, height: D }}>
      <svg width={D} height={D} viewBox={`0 0 ${D} ${D}`} style={{ overflow: 'visible' }}>
        <circle cx={D / 2} cy={D / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={line} />
        <g transform={`rotate(-90 ${D / 2} ${D / 2})`} opacity={busy ? 0.3 : 1} style={{ transition: 'opacity .2s' }}>
          <circle
            className="arc"
            cx={D / 2}
            cy={D / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={line}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            style={{ filter: highlight ? `drop-shadow(0 0 ${10 * m.scale}px ${color}6B)` : 'none', display: view.arc > 0 ? undefined : 'none' }}
          />
        </g>
        {busy && (
          <g className="refresh-spin" style={{ transformOrigin: `${D / 2}px ${D / 2}px` }}>
            <circle
              cx={D / 2}
              cy={D / 2}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={line}
              strokeLinecap="round"
              strokeDasharray={`${refreshDash} ${circumference}`}
              transform={`rotate(-90 ${D / 2} ${D / 2})`}
            />
          </g>
        )}
        {view.clock !== null && <ClockArc D={D} line={line} scale={m.scale} fraction={view.clock} />}
      </svg>
      <div className="ring-icon" style={{ opacity: view.hasReading ? 1 : 0.35 }}>
        <ProviderIcon name={icon} size={centre * 0.8} />
      </div>
    </div>
  )
}

/** Neutral hairline outside the usage ring: how far the window has run. */
function ClockArc({ D, line, scale, fraction }: { D: number; line: number; scale: number; fraction: number }) {
  const w = 2 * scale
  const rr = D / 2 + line / 2 + (3 + 1) * scale
  const c = 2 * Math.PI * rr
  return (
    <g>
      <circle cx={D / 2} cy={D / 2} r={rr} fill="none" stroke="currentColor" strokeOpacity={0.16} strokeWidth={w} />
      <circle
        cx={D / 2}
        cy={D / 2}
        r={rr}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.7}
        strokeWidth={w}
        strokeLinecap="round"
        strokeDasharray={`${c * fraction} ${c}`}
        transform={`rotate(-90 ${D / 2} ${D / 2})`}
      />
    </g>
  )
}

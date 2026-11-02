import { useEffect, useMemo, useRef, useState } from 'react'
import { type Locale, translator } from '@shared/i18n'

/** Re-renders every `ms` (for "Updated 3 min. ago" and elapsed arcs). */
export function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

export function useT(locale: Locale) {
  return useMemo(() => translator(locale), [locale])
}

/** Critically-damped-ish spring toward `target`; returns the animated value. */
export function useSpring(target: number, response = 0.28, snap = false): number {
  const [value, setValue] = useState(target)
  const state = useRef({ x: target, v: 0, target })
  state.current.target = target
  const raf = useRef(0)

  useEffect(() => {
    if (snap) {
      state.current.x = target
      state.current.v = 0
      setValue(target)
      return
    }
    let last = performance.now()
    const omega = (2 * Math.PI) / response
    const step = (nowMs: number): void => {
      const dt = Math.min((nowMs - last) / 1000, 0.05)
      last = nowMs
      const s = state.current
      // Critically damped spring, semi-implicit Euler.
      const a = -2 * omega * s.v - omega * omega * (s.x - s.target)
      s.v += a * dt
      s.x += s.v * dt
      if (Math.abs(s.x - s.target) < 0.05 && Math.abs(s.v) < 0.5) {
        s.x = s.target
        s.v = 0
        setValue(s.x)
        raf.current = 0
        return
      }
      setValue(s.x)
      raf.current = requestAnimationFrame(step)
    }
    if (!raf.current) raf.current = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf.current)
      raf.current = 0
    }
  }, [target, response, snap])

  return value
}

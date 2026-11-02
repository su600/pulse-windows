/** SVG outlines for the rail and the detail card. Drawn once, facing right, then mirrored. */

const K = 0.5523

/**
 * The docked rail: a flat black body welded to the screen edge (at x = W) with
 * concave flares at both ends, so it grows out of the edge instead of resting
 * on it. `cornerRadius + flareWidth === W` so the flat top has no length.
 */
export function dockedRailPath(W: number, H: number, flareW: number, flareH: number, r: number): string {
  const fx = W - flareW
  const s = 0.62 // squarer than a circle: the shipped rail's superellipse corners
  const f = (n: number): string => n.toFixed(2)
  return [
    `M ${f(W)} 0`,
    `C ${f(W)} ${f(K * flareH)} ${f(fx + K * flareW)} ${f(flareH)} ${f(fx)} ${f(flareH)}`,
    `C ${f(fx - r * s)} ${f(flareH)} 0 ${f(flareH + r * (1 - s))} 0 ${f(flareH + r)}`,
    `L 0 ${f(H - flareH - r)}`,
    `C 0 ${f(H - flareH - r * (1 - s))} ${f(fx - r * s)} ${f(H - flareH)} ${f(fx)} ${f(H - flareH)}`,
    `C ${f(fx + K * flareW)} ${f(H - flareH)} ${f(W)} ${f(H - K * flareH)} ${f(W)} ${f(H)}`,
    'Z'
  ].join(' ')
}

export function capsulePath(W: number, H: number): string {
  const r = W / 2
  return `M ${r} 0 A ${r} ${r} 0 0 1 ${W} ${r} L ${W} ${H - r} A ${r} ${r} 0 0 1 ${r} ${H} A ${r} ${r} 0 0 1 0 ${H - r} L 0 ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`
}

/**
 * The card and its pointer as ONE path (two shapes animating separately drift
 * apart). Facing right: the pointer leaves the right edge, centred `centre`
 * down from the top. Mirror with scaleX(-1) for a card on the other side.
 */
export function bubblePath(w: number, h: number, r: number, pw: number, ph: number, centre: number): string {
  const bw = w - pw
  const half = ph / 2
  const lo = r + half
  const hi = Math.max(h - r - half, lo)
  const c = Math.min(Math.max(centre, lo), hi)
  const f = (n: number): string => n.toFixed(2)
  const near = [0.24, 0.44]
  const far = [0.55, 0.24]
  return [
    `M ${f(r)} 0`,
    `H ${f(bw - r)}`,
    `C ${f(bw - r + K * r)} 0 ${f(bw)} ${f(r - K * r)} ${f(bw)} ${f(r)}`,
    `V ${f(c - half)}`,
    `C ${f(bw + pw * near[0])} ${f(c - half * near[1])} ${f(bw + pw * far[0])} ${f(c - half * far[1])} ${f(w)} ${f(c)}`,
    `C ${f(bw + pw * far[0])} ${f(c + half * far[1])} ${f(bw + pw * near[0])} ${f(c + half * near[1])} ${f(bw)} ${f(c + half)}`,
    `V ${f(h - r)}`,
    `C ${f(bw)} ${f(h - r + K * r)} ${f(bw - r + K * r)} ${f(h)} ${f(bw - r)} ${f(h)}`,
    `H ${f(r)}`,
    `C ${f(r - K * r)} ${f(h)} 0 ${f(h - r + K * r)} 0 ${f(h - r)}`,
    `V ${f(r)}`,
    `C 0 ${f(r - K * r)} ${f(r - K * r)} 0 ${f(r)} 0`,
    'Z'
  ].join(' ')
}

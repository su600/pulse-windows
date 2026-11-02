// Rasterises the Pulse mark (AppIcon/pulse-mark.svg) into PNGs without any
// dependency: build/icon.png (app icon) and resources/tray-{light,dark}.png.
// Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// The mark: one stroke, in a 1024 space. Vertical, across, a half-circle bowl, back.
const STROKE = 50 // half of stroke-width 100
const segments = []
const poly = [[352, 780], [352, 244], [562, 244]]
for (let i = 0; i < poly.length - 1; i++) segments.push([poly[i], poly[i + 1]])
let prev = [562, 244]
for (let i = 1; i <= 48; i++) {
  const a = -Math.PI / 2 + (Math.PI * i) / 48
  const p = [562 + 150 * Math.cos(a), 394 + 150 * Math.sin(a)]
  segments.push([prev, p])
  prev = p
}
segments.push([prev, [530, 544]])

function distToSegment(px, py, [[x1, y1], [x2, y2]]) {
  const dx = x2 - x1, dy = y2 - y1
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}
function coverage(px, py) {
  let d = Infinity
  for (const s of segments) d = Math.min(d, distToSegment(px, py, s))
  return d <= STROKE ? 1 : 0
}

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y)
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// Mark bounds 302..762 x 194..830; centre it with some padding.
const BOUNDS = { x0: 302, x1: 762, y0: 194, y1: 830 }
function markAt(size, scale, x, y, ss = 4) {
  const cx = (BOUNDS.x0 + BOUNDS.x1) / 2, cy = (BOUNDS.y0 + BOUNDS.y1) / 2
  let hit = 0
  for (let i = 0; i < ss; i++) for (let j = 0; j < ss; j++) {
    const u = ((x + (i + 0.5) / ss) - size / 2) / scale + cx
    const v = ((y + (j + 0.5) / ss) - size / 2) / scale + cy
    hit += coverage(u, v)
  }
  return hit / (ss * ss)
}

function roundedRect(size, radius, x, y) {
  const dx = Math.max(Math.abs(x + 0.5 - size / 2) - (size / 2 - radius), 0)
  const dy = Math.max(Math.abs(y + 0.5 - size / 2) - (size / 2 - radius), 0)
  const d = Math.hypot(dx, dy) - radius
  return Math.max(0, Math.min(1, 0.5 - d))
}

mkdirSync(join(root, 'build'), { recursive: true })
mkdirSync(join(root, 'resources'), { recursive: true })

// App icon: black rounded square, white mark.
const APP = 256
const appPng = png(APP, (x, y) => {
  const bg = roundedRect(APP, 56, x, y)
  const m = markAt(APP, (APP * 0.52) / (BOUNDS.y1 - BOUNDS.y0), x, y)
  const v = Math.round(11 + (255 - 11) * m)
  return [v, v, v, Math.round(bg * 255)]
})
writeFileSync(join(root, 'build', 'icon.png'), appPng)

// Windows .ico (for shortcuts and the installer): one 256x256 PNG-compressed image.
const ico = Buffer.alloc(22)
ico.writeUInt16LE(0, 0) // reserved
ico.writeUInt16LE(1, 2) // type: icon
ico.writeUInt16LE(1, 4) // image count
ico[6] = 0 // width 256 is stored as 0
ico[7] = 0 // height 256 is stored as 0
ico.writeUInt16LE(1, 10) // colour planes
ico.writeUInt16LE(32, 12) // bits per pixel
ico.writeUInt32LE(appPng.length, 14) // image size
ico.writeUInt32LE(22, 18) // image offset
writeFileSync(join(root, 'build', 'icon.ico'), Buffer.concat([ico, appPng]))

// Tray: just the mark, in the taskbar's ink.
for (const [name, rgb] of [['light', [245, 245, 247]], ['dark', [11, 11, 12]]]) {
  const S = 32
  writeFileSync(join(root, 'resources', `tray-${name}.png`), png(S, (x, y) => {
    const m = markAt(S, (S * 0.86) / (BOUNDS.y1 - BOUNDS.y0), x, y, 6)
    return [...rgb, Math.round(m * 255)]
  }))
}
console.log('icons written')

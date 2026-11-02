import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { dlog } from './log'
import type { PanelController } from './panel'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Developer-only: PULSE_SHOT=<dir> renders the panel in a few poses and writes
 * PNGs, then quits. The pointer is faked through `debugPointer` so no real
 * mouse is needed.
 */
export async function runShots(panel: PanelController, dir: string, hoverIndexes: number[], onDone: () => void): Promise<void> {
  dlog('shots start')
  mkdirSync(dir, { recursive: true })
  await wait(2500)
  const wc = panel.win.webContents
  await wc.executeJavaScript("document.body.style.background = '#f4f4f4'")
  const grab = async (name: string): Promise<void> => {
    await wait(900)
    const image = await wc.capturePage()
    writeFileSync(join(dir, `${name}.png`), image.toPNG())
    dlog(`shot ${name}`)
  }
  panel.debugPointer = null
  await grab('rail')
  for (const i of hoverIndexes) {
    const p = panel.ringPoint(i)
    if (!p) continue
    panel.debugPointer = p
    await grab(`hover-${i}`)
  }
  onDone()
}

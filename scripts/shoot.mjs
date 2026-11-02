// Developer helper: screenshots the renderers served by `npm run dev:web` with the mock backend.
// node scripts/shoot.mjs <outDir> [panel|settings|all]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const out = process.argv[2] ?? 'shots'
mkdirSync(out, { recursive: true })
const base = process.env.PULSE_WEB ?? 'http://localhost:5183'

const browser = await chromium.launch({
  executablePath: process.env.PULSE_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--no-sandbox'],
  headless: true
})

function watch(page, name) {
  page.on('pageerror', (e) => console.log('pageerror', name, e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('console.error', name, m.text())
  })
}

async function panel(name, query, ring, size = { width: 420, height: 900 }) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 2 })
  watch(page, name)
  await page.goto(`${base}/panel.html?${query}`)
  await page.waitForTimeout(700)
  if (ring !== null && ring !== undefined) {
    const box = await page.locator('.item').nth(ring).boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(1100)
  }
  await page.screenshot({ path: join(out, `${name}.png`) })
  await page.close()
}

async function settings(name, query, click) {
  const page = await browser.newPage({ viewport: { width: 920, height: 660 }, deviceScaleFactor: 1.5 })
  watch(page, name)
  await page.goto(`${base}/settings.html?${query}`)
  await page.waitForTimeout(600)
  if (click) {
    await page.getByText(click, { exact: true }).first().click()
    await page.waitForTimeout(300)
  }
  await page.screenshot({ path: join(out, `${name}.png`) })
  await page.close()
}

const which = process.argv[3] ?? 'all'
if (which === 'all' || which === 'panel') {
  await panel('panel-rail', 'mock=demo', null)
  await panel('panel-hover-1', 'mock=demo', 1)
  await panel('panel-hover-2', 'mock=demo', 2)
  await panel('panel-light', 'mock=demo&light=1', 1)
  await panel('panel-left', 'mock=demo&pos=left', 2)
  await panel('panel-segmented', 'mock=demo&bars=segmented', 2)
  await panel('panel-zh', 'mock=real&lang=zh-CN', 0)
}
if (which === 'all' || which === 'settings') {
  await settings('settings-appearance', 'mock=real&lang=en', null)
  await settings('settings-copilot', 'mock=real&lang=en', 'GitHub Copilot')
  await settings('settings-setup', 'mock=setup&lang=en', null)
  await settings('settings-zh', 'mock=real&lang=zh-CN', null)
}
await browser.close()
console.log('done')

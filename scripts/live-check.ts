/**
 * Developer helper: runs the real adapters against this PC's own logins and
 * prints only what the panel would show (never a token).
 *   npx vite-node --config vitest.config.ts scripts/live-check.ts [copilot-device]
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { claudeCode } from '../src/main/providers/claudeCode'
import { codex } from '../src/main/providers/codex'
import { startDeviceLogin } from '../src/main/providers/copilotLogin'
import type { FetchContext, HttpFn } from '../src/main/providers/types'

const http: HttpFn = async (url, init = {}) => {
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: init.headers,
    body: init.body,
    signal: AbortSignal.timeout(init.timeoutMs ?? 20_000)
  })
  return { status: response.status, text: await response.text() }
}

const ctx = (): FetchContext => ({
  http,
  now: Date.now(),
  homeDir: homedir(),
  env: process.env,
  readFile: (p) => {
    try {
      return existsSync(p) ? readFileSync(p, 'utf8') : null
    } catch {
      return null
    }
  },
  secret: null
})

function show(name: string, r: Awaited<ReturnType<typeof claudeCode.fetch>>): void {
  console.log(`\n== ${name}: ${r.availability}${r.plan ? ` (plan ${r.plan})` : ''}`)
  for (const w of r.windows ?? []) {
    const pct = w.usedFraction === null ? '—' : `${Math.round(w.usedFraction * 100)}%`
    const reset = w.resetsAt ? new Date(w.resetsAt).toLocaleString() : 'no reset reported'
    console.log(`   ${w.kind}${w.scope ? ` · ${w.scope}` : ''}: ${pct} used${w.isExhausted ? ' [SPENT]' : ''}, resets ${reset}`)
  }
  if (r.creditBalance) console.log(`   credits: ${r.creditBalance}`)
}

const which = process.argv[2] ?? 'cli'
if (which === 'cli' || which === 'all') {
  show('Claude Code', await claudeCode.fetch(ctx()))
  show('Codex', await codex.fetch(ctx()))
}
if (which === 'copilot-device' || which === 'all') {
  // Asks GitHub for a device code only; nothing is authorised.
  const prompt = await startDeviceLogin(http)
  console.log(`\n== Copilot device flow reachable: code ${prompt.userCode.length} chars, verify at ${prompt.verificationUrl}, poll every ${prompt.intervalMs / 1000}s`)
}

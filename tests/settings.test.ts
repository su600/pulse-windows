import { describe, expect, it } from 'vitest'
import { DeviceLoginError, awaitDeviceToken, startDeviceLogin } from '../src/main/providers/copilotLogin'
import type { HttpFn } from '../src/main/providers/types'
import { applyPatch, sanitizeSettings } from '../src/shared/settings'
import { DEFAULT_SETTINGS } from '../src/shared/types'

describe('settings safety', () => {
  it('turns blank, damaged or unknown-version state into "set up not done, nothing enabled"', () => {
    for (const raw of [null, undefined, 'garbage', 42, [], {}, { version: 2, enabled: ['copilot'] }]) {
      const s = sanitizeSettings(raw)
      expect(s.setupDone).toBe(false)
      expect(s.enabled).toEqual([])
    }
  })

  it('never enables everything by default', () => {
    expect(DEFAULT_SETTINGS.enabled).toEqual([])
    expect(DEFAULT_SETTINGS.setupDone).toBe(false)
  })

  it('drops unknown providers and duplicates, and repairs bad values', () => {
    const s = sanitizeSettings({
      version: 1,
      setupDone: true,
      enabled: ['copilot', 'nonsense', 'copilot', 'codex'],
      panel: { size: 'huge', warningThreshold: 5, ratio: -3, position: 'top' },
      refresh: { seconds: 1 },
      notifications: { warnAt: 0.2 },
      network: { mode: 'manual', host: ' proxy.local ', port: 99999 },
      accounts: { copilot: { ringTint: 'red', detailedCard: true }, bogus: {} }
    })
    expect(s.enabled).toEqual(['copilot', 'codex'])
    expect(s.panel.size).toBe('standard')
    expect(s.panel.warningThreshold).toBe(0.9)
    expect(s.panel.ratio).toBe(0)
    expect(s.panel.position).toBe('right')
    expect(s.refresh.seconds).toBe(120)
    expect(s.notifications.warnAt).toBe(0.5)
    expect(s.network).toEqual({ mode: 'manual', host: 'proxy.local', port: 65535 })
    expect(s.accounts.copilot).toEqual({ pinnedWindow: null, ringTint: null, detailedCard: true })
    expect('bogus' in s.accounts).toBe(false)
  })

  it('applies a patch field by field and cannot change the version', () => {
    const s = sanitizeSettings({ version: 1, setupDone: true, enabled: ['codex'] })
    const next = applyPatch(s, { panel: { size: 'large' }, version: 9 } as never)
    expect(next.panel.size).toBe('large')
    expect(next.panel.spacing).toBe('standard')
    expect(next.version).toBe(1)
    expect(next.enabled).toEqual(['codex'])
  })
})

describe('Copilot device sign-in', () => {
  const json = (body: unknown, status = 200) => ({ status, text: JSON.stringify(body) })
  const noWait = async (): Promise<void> => {}

  it('asks for read:user only, and the link never carries the code', async () => {
    let sent: Record<string, string> = {}
    const http: HttpFn = async (_url, init) => {
      sent = JSON.parse(init?.body ?? '{}')
      return json({ user_code: 'ABCD-1234', device_code: 'dc', verification_uri: 'https://github.com/login/device', interval: 5 })
    }
    const prompt = await startDeviceLogin(http)
    expect(sent.scope).toBe('read:user')
    expect(prompt.userCode).toBe('ABCD-1234')
    expect(prompt.verificationUrl).toBe('https://github.com/login/device')
    expect(prompt.verificationUrl.includes('ABCD')).toBe(false)
    expect(prompt.intervalMs).toBe(5000)
  })

  it('keeps polling while pending, honours slow_down, then returns the token', async () => {
    const replies = [{ error: 'authorization_pending' }, { error: 'slow_down', interval: 10 }, { access_token: 'gho_token' }]
    let i = 0
    const http: HttpFn = async () => json(replies[i++])
    const token = await awaitDeviceToken(http, { userCode: 'x', deviceCode: 'dc', verificationUrl: 'u', intervalMs: 1000 }, new AbortController().signal, noWait)
    expect(token).toBe('gho_token')
    expect(i).toBe(3)
  })

  it('reports a declined, an expired and a cancelled sign-in as distinct outcomes', async () => {
    const prompt = { userCode: 'x', deviceCode: 'dc', verificationUrl: 'u', intervalMs: 1000 }
    const attempt = (reply: unknown, signal = new AbortController().signal) =>
      awaitDeviceToken(async () => json(reply), prompt, signal, noWait).catch((e: DeviceLoginError) => e.reason)
    expect(await attempt({ error: 'access_denied' })).toBe('declined')
    expect(await attempt({ error: 'expired_token' })).toBe('timedOut')
    const aborted = new AbortController()
    aborted.abort()
    expect(await attempt({ error: 'authorization_pending' }, aborted.signal)).toBe('cancelled')
  })

  it('explains a refusal in GitHub words, and a network failure as unreachable', async () => {
    const refused = await startDeviceLogin(async () => json({ error: 'device_flow_disabled', error_description: 'Device Flow must be explicitly enabled' }, 400)).catch((e: DeviceLoginError) => e)
    expect(refused).toBeInstanceOf(DeviceLoginError)
    expect((refused as DeviceLoginError).message).toContain('Device Flow must be explicitly enabled')
    const down = await startDeviceLogin(async () => { throw new Error('offline') }).catch((e: DeviceLoginError) => e.reason)
    expect(down).toBe('network')
  })
})

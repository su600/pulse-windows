import type { HttpFn } from './types'
import { parseJson } from './types'

/**
 * Signing in to GitHub for Copilot's quota, by device code (RFC 8628).
 *
 * A sign-in rather than a pasted token, deliberately: the quota endpoint
 * accepts any GitHub OAuth token, but the one `gh` holds carries `repo` and
 * `workflow`. This asks for `read:user` and nothing else. It drives the public
 * client the VS Code Copilot plugin ships (not a secret), so the consent page
 * names the editor rather than Pulse.
 *
 * The verification link must NOT carry the code: GitHub deliberately sends no
 * `verification_uri_complete`, and pre-filling a code is the device-code
 * phishing shape. The code goes on the clipboard instead.
 */
const CLIENT_ID = 'Iv1.b507a08c87ecfe98'
const SCOPE = 'read:user'
const CODE_URL = 'https://github.com/login/device/code'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const PATIENCE_MS = 900_000

export interface DevicePrompt {
  userCode: string
  verificationUrl: string
  deviceCode: string
  intervalMs: number
}

export class DeviceLoginError extends Error {
  constructor(
    readonly reason: 'refused' | 'declined' | 'timedOut' | 'cancelled' | 'network',
    message: string
  ) {
    super(message)
  }
}

async function post(http: HttpFn, url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  let response
  try {
    response = await http(url, {
      method: 'POST',
      // Without Accept, GitHub answers form-encoded, which parses as nothing.
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 20_000
    })
  } catch {
    throw new DeviceLoginError('network', "The service didn't respond.")
  }
  const json = parseJson(response.text)
  if (response.status >= 400) {
    const said = json && typeof json.error_description === 'string' ? json.error_description : json && typeof json.error === 'string' ? json.error : null
    throw new DeviceLoginError('refused', `${new URL(url).pathname}: HTTP ${response.status}${said ? ` — ${said}` : ''}`)
  }
  if (!json) throw new DeviceLoginError('refused', "Couldn't read the reply.")
  return json
}

export async function startDeviceLogin(http: HttpFn): Promise<DevicePrompt> {
  const reply = await post(http, CODE_URL, { client_id: CLIENT_ID, scope: SCOPE })
  const userCode = reply.user_code
  const deviceCode = reply.device_code
  const verification = reply.verification_uri
  if (typeof userCode !== 'string' || typeof deviceCode !== 'string' || typeof verification !== 'string') {
    throw new DeviceLoginError('refused', 'login/device/code: unexpected reply')
  }
  const interval = typeof reply.interval === 'number' ? Math.min(Math.max(reply.interval, 1), 60) : 5
  return { userCode, deviceCode, verificationUrl: verification, intervalMs: interval * 1000 }
}

export async function awaitDeviceToken(
  http: HttpFn,
  prompt: DevicePrompt,
  signal: AbortSignal,
  sleep: (ms: number, signal: AbortSignal) => Promise<void>
): Promise<string> {
  const deadline = Date.now() + PATIENCE_MS
  let wait = prompt.intervalMs
  while (Date.now() < deadline) {
    await sleep(wait, signal)
    if (signal.aborted) throw new DeviceLoginError('cancelled', 'Sign-in was cancelled.')
    const reply = await post(http, TOKEN_URL, {
      client_id: CLIENT_ID,
      device_code: prompt.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
    if (typeof reply.access_token === 'string' && reply.access_token !== '') return reply.access_token
    const error = reply.error
    if (error === undefined || error === 'authorization_pending') continue
    if (error === 'slow_down') {
      wait = Math.min(Math.max(typeof reply.interval === 'number' ? reply.interval * 1000 : 10_000, 1000), 60_000)
      continue
    }
    if (error === 'access_denied') throw new DeviceLoginError('declined', 'Sign-in was cancelled.')
    if (error === 'expired_token') throw new DeviceLoginError('timedOut', "The browser didn't come back.")
    throw new DeviceLoginError('refused', `login/oauth/access_token — ${String(reply.error_description ?? error)}`)
  }
  throw new DeviceLoginError('timedOut', "The browser didn't come back.")
}

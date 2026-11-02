import { net, session } from 'electron'
import type { AppSettings } from '@shared/types'
import type { HttpFn } from './providers/types'

/** Chromium's network stack: honours the system proxy and the user's choice. */
export const http: HttpFn = async (url, init = {}) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 20_000)
  try {
    const response = await net.fetch(url, {
      method: init.method ?? 'GET',
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
      // Credentials must never ride on cookies or be cached.
      credentials: 'omit',
      cache: 'no-store'
    })
    return { status: response.status, text: await response.text() }
  } finally {
    clearTimeout(timer)
  }
}

export async function applyProxy(network: AppSettings['network']): Promise<void> {
  const ses = session.defaultSession
  if (network.mode === 'none') {
    await ses.setProxy({ mode: 'direct' })
  } else if (network.mode === 'manual' && network.host && network.port > 0) {
    await ses.setProxy({ mode: 'fixed_servers', proxyRules: `http://${network.host}:${network.port}` })
  } else {
    await ses.setProxy({ mode: 'system' })
  }
}

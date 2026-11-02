import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EMPTY_MEMORY, type AlertMemory } from '@shared/alerts'
import { sanitizeSettings } from '@shared/settings'
import type { AppSettings, ProviderId, UsageSnapshot } from '@shared/types'

const dir = (): string => {
  const d = app.getPath('userData')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

/** Atomic write: a crash mid-write must never leave a half-written file. */
function writeAtomic(file: string, data: string): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, data, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file)
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function loadSettings(): AppSettings {
  return sanitizeSettings(readJson(join(dir(), 'settings.json')))
}

export function saveSettings(settings: AppSettings): void {
  writeAtomic(join(dir(), 'settings.json'), JSON.stringify(settings, null, 2))
}

// ---------------------------------------------------------------- snapshots

const SNAPSHOT_SCHEMA = 1

export function loadSnapshots(): Partial<Record<ProviderId, UsageSnapshot>> {
  const raw = readJson(join(dir(), 'snapshots.json'))
  if (!raw || typeof raw !== 'object' || (raw as { schema?: number }).schema !== SNAPSHOT_SCHEMA) return {}
  const snapshots = (raw as { snapshots?: Record<string, UsageSnapshot> }).snapshots
  return snapshots && typeof snapshots === 'object' ? (snapshots as Partial<Record<ProviderId, UsageSnapshot>>) : {}
}

export function saveSnapshots(snapshots: Partial<Record<ProviderId, UsageSnapshot>>): void {
  writeAtomic(join(dir(), 'snapshots.json'), JSON.stringify({ schema: SNAPSHOT_SCHEMA, snapshots }))
}

// ---------------------------------------------------------------- alert memory

export function loadAlertMemory(): AlertMemory {
  const raw = readJson(join(dir(), 'alert-memory.json'))
  if (raw && typeof raw === 'object' && 'windows' in raw && 'failures' in raw) return raw as AlertMemory
  return structuredClone(EMPTY_MEMORY)
}

export function saveAlertMemory(memory: AlertMemory): void {
  writeAtomic(join(dir(), 'alert-memory.json'), JSON.stringify(memory))
}

// ---------------------------------------------------------------- secrets

/**
 * Secrets are encrypted with the OS (DPAPI on Windows) via safeStorage and kept
 * apart from the settings file. If the OS cannot encrypt, nothing is stored:
 * a secret is never written in the clear.
 */
const secretsFile = (): string => join(dir(), 'secrets.dat')

function readSecrets(): Record<string, string> | null {
  if (!existsSync(secretsFile())) return {}
  const raw = readJson(secretsFile())
  // A file that exists but will not decode is not empty: refuse to overwrite.
  if (!raw || typeof raw !== 'object') return null
  return raw as Record<string, string>
}

export function secretsAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function getSecret(id: ProviderId): string | null {
  const all = readSecrets()
  const blob = all?.[id]
  if (!blob || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(blob, 'base64'))
  } catch {
    return null
  }
}

export function hasSecret(id: ProviderId): boolean {
  return getSecret(id) !== null
}

export function setSecret(id: ProviderId, value: string): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  const all = readSecrets()
  if (all === null) return false
  all[id] = safeStorage.encryptString(value).toString('base64')
  writeAtomic(secretsFile(), JSON.stringify(all))
  return true
}

export function clearSecret(id: ProviderId): void {
  const all = readSecrets()
  if (all === null || !(id in all)) return
  delete all[id]
  writeAtomic(secretsFile(), JSON.stringify(all))
}

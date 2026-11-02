import { MAX_CACHE_AGE_MS, emptySnapshot } from '@shared/rules'
import type { ProviderId, UsageSnapshot } from '@shared/types'
import type { AdapterResult } from './providers/types'

export interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export interface CoordinatorDeps {
  now(): number
  run(id: ProviderId): Promise<AdapterResult>
  initial: Partial<Record<ProviderId, UsageSnapshot>>
  persist(snapshots: Partial<Record<ProviderId, UsageSnapshot>>): void
  /** A fresh snapshot arrived (live or failed). */
  onSnapshot(snapshot: UsageSnapshot): void
  /** Anything the panel draws changed (snapshots or refreshing flags). */
  onChange(): void
  timers?: Timers
  /** Minimum time the refresh mark stays up, so a fast local read registers. */
  minRefreshMs?: number
}

/** Failures after which the last good figures are still worth showing. */
const KEEPS_CACHE = new Set(['unreachable', 'serverError', 'rateLimited', 'unreadableReply', 'loginExpired'])
const MAX_BACKOFF = 4

/**
 * Owns refreshing. One effective task per account: a click while one is out
 * joins it, and a result from a task that has been superseded (account
 * disabled, re-enabled) is discarded, so an old answer can never overwrite a
 * newer one. A disabled account is never read.
 */
export class RefreshCoordinator {
  private snapshots = new Map<ProviderId, UsageSnapshot>()
  private lastGood = new Map<ProviderId, UsageSnapshot>()
  private inFlight = new Map<ProviderId, Promise<void>>()
  private generation = new Map<ProviderId, number>()
  private nextDue = new Map<ProviderId, number>()
  private backoff = new Map<ProviderId, number>()
  private enabled: ProviderId[] = []
  private intervalMs = 300_000
  private timer: unknown = null
  private running = false
  private readonly timers: Timers

  constructor(private readonly deps: CoordinatorDeps) {
    this.timers = deps.timers ?? {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
    }
  }

  get refreshing(): ReadonlySet<ProviderId> {
    return new Set(this.inFlight.keys())
  }

  snapshotFor(id: ProviderId): UsageSnapshot | undefined {
    return this.snapshots.get(id)
  }

  setInterval(seconds: number): void {
    this.intervalMs = seconds * 1000
    if (this.running) this.schedule()
  }

  /**
   * Replaces the enabled set. Newly enabled accounts restore their last good
   * snapshot (shown as cache until the first read lands) and read at once;
   * disabled ones stop and forget.
   */
  setEnabled(ids: ProviderId[]): void {
    const before = new Set(this.enabled)
    this.enabled = [...ids]
    for (const id of before) {
      if (!ids.includes(id)) this.forget(id)
    }
    for (const id of ids) {
      if (before.has(id)) continue
      const restored = this.deps.initial[id]
      if (restored && restored.availability === 'live') {
        const cached = { ...restored, origin: 'cache' as const }
        this.snapshots.set(id, cached)
        this.lastGood.set(id, restored)
      } else if (!this.snapshots.has(id)) {
        this.snapshots.set(id, emptySnapshot(id, id, 'loading', this.deps.now()))
      }
      this.nextDue.set(id, 0)
      if (this.running) void this.refresh(id)
    }
    this.deps.onChange()
    if (this.running) this.schedule()
  }

  start(): void {
    if (this.running) return
    this.running = true
    for (const id of this.enabled) void this.refresh(id)
    this.schedule()
  }

  stop(): void {
    this.running = false
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = null
  }

  /** Refreshes one account now. Joins a read already in flight. */
  refresh(id: ProviderId): Promise<void> {
    if (!this.enabled.includes(id)) return Promise.resolve()
    const existing = this.inFlight.get(id)
    if (existing) return existing

    const gen = (this.generation.get(id) ?? 0) + 1
    this.generation.set(id, gen)
    const started = this.deps.now()

    const task = (async () => {
      let result: AdapterResult
      try {
        result = await this.deps.run(id)
      } catch {
        result = { availability: 'unreachable' }
      }
      const minimum = this.deps.minRefreshMs ?? 650
      const elapsed = this.deps.now() - started
      if (elapsed < minimum) await new Promise((r) => this.timers.set(() => r(null), minimum - elapsed))

      // Superseded or disabled while the request was out: drop the answer.
      if (this.generation.get(id) === gen && this.enabled.includes(id)) this.apply(id, result)
    })().finally(() => {
      // Only clear our own entry: a newer task may have replaced it.
      if (this.inFlight.get(id) === task) this.inFlight.delete(id)
      this.deps.onChange()
      if (this.running) this.schedule()
    })

    this.inFlight.set(id, task)
    this.deps.onChange()
    return task
  }

  refreshAll(): Promise<void[]> {
    return Promise.all(this.enabled.map((id) => this.refresh(id)))
  }

  private apply(id: ProviderId, result: AdapterResult): void {
    const now = this.deps.now()
    const base = emptySnapshot(id, id, result.availability, now)
    let snapshot: UsageSnapshot

    if (result.availability === 'live') {
      snapshot = {
        ...base,
        windows: result.windows ?? [],
        plan: result.plan ?? null,
        creditBalance: result.creditBalance ?? null,
        balance: result.balance ?? null,
        source: result.source ?? null
      }
      this.lastGood.set(id, snapshot)
      this.backoff.set(id, 1)
      this.deps.persist(this.persistable())
    } else {
      const good = this.lastGood.get(id)
      if (good && KEEPS_CACHE.has(result.availability) && now - good.observedAt < MAX_CACHE_AGE_MS) {
        snapshot = { ...good, origin: 'cache', staleReason: result.availability }
      } else {
        snapshot = { ...base, source: result.source ?? null }
        if (!KEEPS_CACHE.has(result.availability)) this.lastGood.delete(id)
      }
      const factor = result.availability === 'rateLimited' ? Math.min((this.backoff.get(id) ?? 1) * 2, MAX_BACKOFF) : (this.backoff.get(id) ?? 1)
      this.backoff.set(id, factor)
    }

    this.snapshots.set(id, snapshot)
    this.nextDue.set(id, now + this.intervalMs * (this.backoff.get(id) ?? 1))
    // Alerts see the reading as the service gave it, not the cache merge.
    this.deps.onSnapshot({ ...base, ...snapshot, availability: result.availability, windows: result.availability === 'live' ? snapshot.windows : [] })
    this.deps.onChange()
  }

  private forget(id: ProviderId): void {
    this.generation.set(id, (this.generation.get(id) ?? 0) + 1)
    this.inFlight.delete(id)
    this.snapshots.delete(id)
    this.lastGood.delete(id)
    this.nextDue.delete(id)
    this.backoff.delete(id)
    this.deps.persist(this.persistable())
  }

  private persistable(): Partial<Record<ProviderId, UsageSnapshot>> {
    const out: Partial<Record<ProviderId, UsageSnapshot>> = {}
    for (const [id, s] of this.lastGood) if (this.enabled.includes(id)) out[id] = s
    return out
  }

  /** One timer for the earliest due account; never a fixed high-frequency poll. */
  private schedule(): void {
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = null
    if (!this.running) return
    let earliest = Infinity
    for (const id of this.enabled) {
      if (this.inFlight.has(id)) continue
      earliest = Math.min(earliest, this.nextDue.get(id) ?? 0)
    }
    if (!Number.isFinite(earliest)) return
    const delay = Math.max(earliest - this.deps.now(), 5_000)
    this.timer = this.timers.set(() => {
      this.timer = null
      const now = this.deps.now()
      for (const id of this.enabled) {
        if ((this.nextDue.get(id) ?? 0) <= now) void this.refresh(id)
      }
      this.schedule()
    }, delay)
  }
}

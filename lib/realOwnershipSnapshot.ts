import { kv } from './noRetryKv.js'
import { waitWithAbort } from './abortablePromise.js'
import { adminStorageConfigured } from './adminEventStore.js'
import { gzipJsonToBase64, gunzipBase64ToJson } from './cloudSyncCompression.js'
import { getUserByUsername, listPasses, RealApiError, type RealApiContext, type RealPass, type RealUser } from './realApi.js'

const TTL_MS = 30_000
const MAX_MEMORY_ENTRIES = 16
const MAX_ENCODED_SIZE = 512_000
type Snapshot = { user: RealUser; passes: RealPass[]; fetchedAt: string; startedAt?: string }
type StoredSnapshot = { version: 1; scope: string; expiresAt: number; payload: string }
export type RealOwnershipSnapshot = Snapshot & { source: 'real' | 'cache' }
const memory = new Map<string, StoredSnapshot>()
const flights = new Map<string, Promise<RealOwnershipSnapshot>>()

function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Snapshot
  return Boolean(snapshot.user?.id && snapshot.user?.userName && Number.isFinite(Date.parse(snapshot.fetchedAt))
    && Array.isArray(snapshot.passes) && snapshot.passes.every((pass) => pass && typeof pass === 'object' && !Array.isArray(pass)))
}

function remember(key: string, value: StoredSnapshot): void {
  memory.delete(key)
  memory.set(key, value)
  while (memory.size > MAX_MEMORY_ENTRIES) memory.delete(memory.keys().next().value!)
}

async function decode(value: unknown, key: string): Promise<RealOwnershipSnapshot | null> {
  if (!value || typeof value !== 'object') return null
  const entry = value as StoredSnapshot
  if (entry.version !== 1 || entry.scope !== key || entry.expiresAt <= Date.now()
    || entry.expiresAt > Date.now() + TTL_MS || typeof entry.payload !== 'string' || entry.payload.length > MAX_ENCODED_SIZE) return null
  try {
    const snapshot = await gunzipBase64ToJson(entry.payload)
    if (!validSnapshot(snapshot) || Date.parse(snapshot.fetchedAt) > Date.now()
      || Date.parse(snapshot.fetchedAt) + TTL_MS <= Date.now()) return null
    remember(key, entry)
    return { ...snapshot, source: 'cache' }
  } catch {
    return null
  }
}

async function scopeKey(username: string, context: RealApiContext): Promise<string> {
  const { baseUrl, authInfo, sessionToken, deviceUuid, version } = context.config
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ baseUrl, authInfo, sessionToken, deviceUuid, version })))
  const fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `rax:ownership:v1:${fingerprint}:${username}`
}

async function loadSnapshot(username: string, context: RealApiContext, forceRefresh: boolean): Promise<RealOwnershipSnapshot> {
  const key = await scopeKey(username, context)
  if (!forceRefresh) {
    const cached = await decode(memory.get(key), key)
    if (cached) return cached
    memory.delete(key)
    if (adminStorageConfigured()) {
      try {
        const stored = await decode(await kv.get(key), key)
        if (stored) return stored
      } catch { /* Optional cache outage must not prevent a live import. */ }
    }
    // A parallel force refresh may have completed during the optional KV lookup.
    const recent = await decode(memory.get(key), key)
    if (recent) return recent
  }
  const existing = flights.get(key)
  if (existing) return existing
  if (flights.size >= 16) throw new RealApiError('rate_limited', 'Ownership sync is busy. Try again shortly.', 429)

  const work = (async (): Promise<RealOwnershipSnapshot> => {
    const startedAt = new Date().toISOString()
    const sharedContext = { ...context, signal: AbortSignal.timeout(60_000) }
    const user = await getUserByUsername(username, sharedContext)
    const passes = await listPasses({ userId: user.id }, sharedContext)
    const snapshot = { user, passes, startedAt, fetchedAt: new Date().toISOString() }
    if (!validSnapshot(snapshot)) throw new RealApiError('invalid_response', 'Real returned a malformed ownership response.')
    const expiresAt = Date.now() + TTL_MS
    try {
      const payload = await gzipJsonToBase64(snapshot)
      if (payload.length <= MAX_ENCODED_SIZE) {
        const entry: StoredSnapshot = { version: 1, scope: key, expiresAt, payload }
        remember(key, entry)
        if (adminStorageConfigured()) {
          try { await kv.set(key, entry, { ex: 30 }) } catch { /* Live result remains usable. */ }
        }
      }
    } catch { /* Compression/cache support is optional; never discard a valid live scan. */ }
    return { ...snapshot, source: 'real' }
  })().finally(() => flights.delete(key))
  flights.set(key, work)
  return work
}

/** Reuse only successful unfiltered responses; no sport/rarity subset is cached as ownership. */
export async function getRealOwnershipSnapshot(
  username: string,
  context: RealApiContext,
  options?: { forceRefresh?: boolean },
): Promise<RealOwnershipSnapshot> {
  if (context.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const normalized = username.trim().replace(/^@/, '').trim().toLowerCase()
  if (!normalized) throw new RealApiError('not_found', 'Enter a Real username.')
  const snapshot = await waitWithAbort(loadSnapshot(normalized, context, options?.forceRefresh === true), context.signal)
  return structuredClone(snapshot)
}

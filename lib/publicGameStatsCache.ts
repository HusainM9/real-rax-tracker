import { kv } from '@vercel/kv'
import { adminStorageConfigured } from './adminEventStore.js'
import type { RealPlayerBoxScore } from './realApi.js'

const CACHE_PREFIX = 'rax:public-final-game:'
const CACHE_TTL_SECONDS = 3 * 24 * 60 * 60
const MEMORY_CACHE_MAX_ENTRIES = 1_000

export type PublicGameStatsCacheEntry = {
  key: string
  rows: RealPlayerBoxScore[]
  cachedAt: string
}

const memoryCache = new Map<string, PublicGameStatsCacheEntry>()

export function publicGameStatsKey(sport: string, gameId: string | number): string {
  return `${sport.toLowerCase()}:${String(gameId)}`
}

function storageKey(key: string): string {
  return `${CACHE_PREFIX}${key}`
}

function remember(entry: PublicGameStatsCacheEntry): void {
  if (memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES && !memoryCache.has(entry.key)) {
    const oldest = memoryCache.keys().next().value as string | undefined
    if (oldest) memoryCache.delete(oldest)
  }
  memoryCache.set(entry.key, entry)
}

export async function readPublicGameStatsCache(
  keys: string[],
): Promise<Map<string, PublicGameStatsCacheEntry>> {
  const uniqueKeys = [...new Set(keys.filter(Boolean))]
  const found = new Map<string, PublicGameStatsCacheEntry>()
  const missing: string[] = []
  for (const key of uniqueKeys) {
    const cached = memoryCache.get(key)
    if (cached) found.set(key, cached)
    else missing.push(key)
  }

  if (missing.length === 0 || !adminStorageConfigured()) return found
  const stored = await kv.mget<Array<PublicGameStatsCacheEntry | null>>(
    ...missing.map(storageKey),
  )
  stored.forEach((entry, index) => {
    const key = missing[index]!
    if (!entry || entry.key !== key || !Array.isArray(entry.rows)) return
    remember(entry)
    found.set(key, entry)
  })
  return found
}

export async function writePublicGameStatsCache(
  entries: PublicGameStatsCacheEntry[],
): Promise<void> {
  if (entries.length === 0) return
  for (const entry of entries) remember(entry)
  if (!adminStorageConfigured()) return

  const pipeline = kv.pipeline()
  for (const entry of entries) {
    pipeline.set(storageKey(entry.key), entry, { ex: CACHE_TTL_SECONDS })
  }
  await pipeline.exec()
}

export function clearPublicGameStatsMemoryCache(): void {
  memoryCache.clear()
}

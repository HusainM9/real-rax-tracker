import { kv } from '@vercel/kv'
import { adminStorageConfigured } from './adminEventStore.js'
import type { RealPlayerBoxScore } from './realApi.js'

const CACHE_PREFIX = 'rax:public-box-score:'
const CACHE_TTL_SECONDS = 2 * 24 * 60 * 60
const MEMORY_CACHE_MAX_ENTRIES = 5_000

export type PublicBoxScoreCacheEntry = {
  id: string
  fingerprint: string
  baseEarnings: number
  /** Detailed stats are required to reproduce card-booster earnings on cache hits. */
  statValues?: RealPlayerBoxScore['statValues']
  cachedAt: string
}

const memoryCache = new Map<string, PublicBoxScoreCacheEntry>()

function cacheKey(id: string): string {
  return `${CACHE_PREFIX}${id}`
}

/**
 * Every bulk field that can affect Real's earnings calculation. Keeping the raw JSON signature
 * avoids trusting a reverse-engineered formula: if the performance changes, the exact detail is
 * fetched again.
 */
export function publicBoxScoreFingerprint(box: RealPlayerBoxScore): string {
  return JSON.stringify({
    value: box.value ?? null,
    played: box.played ?? null,
    didNotPlay: box.didNotPlay ?? null,
    gameStatus: box.gameStatus ?? null,
    status: box.status ?? null,
    updated: box.updated ?? null,
    position: box.position ?? null,
    statValues: box.statValues ?? null,
    advancedStatValues: box.advancedStatValues ?? null,
    fantasyStats: box.fantasyStats ?? null,
    fantasyPointsFanduel: box.fantasyPointsFanduel ?? null,
    performanceTags: box.performanceTags ?? null,
    performanceTagsManual: box.performanceTagsManual ?? null,
  })
}

function remember(entry: PublicBoxScoreCacheEntry): void {
  if (memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES && !memoryCache.has(entry.id)) {
    const oldest = memoryCache.keys().next().value as string | undefined
    if (oldest) memoryCache.delete(oldest)
  }
  memoryCache.set(entry.id, entry)
}

export async function readPublicBoxScoreCache(
  ids: string[],
): Promise<Map<string, PublicBoxScoreCacheEntry>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  const found = new Map<string, PublicBoxScoreCacheEntry>()
  const missing: string[] = []
  for (const id of uniqueIds) {
    const cached = memoryCache.get(id)
    if (cached) found.set(id, cached)
    else missing.push(id)
  }

  if (missing.length === 0 || !adminStorageConfigured()) return found

  const stored = await kv.mget<Array<PublicBoxScoreCacheEntry | null>>(
    ...missing.map(cacheKey),
  )
  stored.forEach((entry, index) => {
    const id = missing[index]!
    if (!entry || entry.id !== id) return
    remember(entry)
    found.set(id, entry)
  })
  return found
}

export async function writePublicBoxScoreCache(
  entries: PublicBoxScoreCacheEntry[],
): Promise<void> {
  if (entries.length === 0) return
  for (const entry of entries) remember(entry)
  if (!adminStorageConfigured()) return

  const pipeline = kv.pipeline()
  for (const entry of entries) {
    pipeline.set(cacheKey(entry.id), entry, { ex: CACHE_TTL_SECONDS })
  }
  await pipeline.exec()
}

/** Test-only reset for deterministic memory-cache coverage. */
export function clearPublicBoxScoreMemoryCache(): void {
  memoryCache.clear()
}

import { BULK_PROFILE_KEYS_MAX_REQUEST } from '../../lib/meowbotCatalogStore'
import { readResponseJson } from './readResponseJson'

export type CatalogPassKind = 'player' | 'team'

export type CatalogSearchResult = {
  externalKey: string
  entityId: number
  passKind: CatalogPassKind
  sport: string
  seasonYear: number
  seasonLabel: string
  name: string
  rarityLabel?: string
  hasEarnings?: boolean
  cachedAt: string
  sourceUpdatedAt?: string
  rowCount: number
  totalBaseRax: number
  latestClaimDay?: string
}

export type CatalogImportProfile = CatalogSearchResult & {
  /** Daily rows in Supabase before season-window filtering. */
  storedRowCount?: number
  rows: {
    claimDay: string
    baseRaxEarned: number
    playerBoxScoreId?: number | null
  }[]
}

export type CatalogSeasonYearOption = {
  seasonYear: number
  seasonLabel: string
}

/** Parallel bulk API requests — each does 2 Supabase queries server-side. */
export const CATALOG_BULK_FETCH_CONCURRENCY = 8

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

async function fetchCatalogImportProfilesBulkBatch(
  batchKeys: string[],
  signal?: AbortSignal,
): Promise<{ profiles: CatalogImportProfile[]; storageConfigured: boolean }> {
  const response = await fetch('/api/catalog/candidates-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ externalKeys: batchKeys }),
    signal,
  })
  const data = await readResponseJson<{
    profiles?: CatalogImportProfile[]
    storageConfigured?: boolean
    error?: string
  }>(response)

  if (!response.ok) {
    throw new Error(data.error || `Catalog bulk import failed (${response.status}).`)
  }

  return {
    profiles: Array.isArray(data.profiles) ? data.profiles : [],
    storageConfigured: data.storageConfigured !== false,
  }
}

export { BULK_PROFILE_KEYS_MAX_REQUEST }

export async function searchCatalog(query: string, signal?: AbortSignal): Promise<{
  results: CatalogSearchResult[]
  storageConfigured: boolean
}> {
  const params = new URLSearchParams({ q: query, limit: '24' })
  const response = await fetch(`/api/catalog/search?${params}`, { signal })
  const data = await readResponseJson<{
    results?: CatalogSearchResult[]
    storageConfigured?: boolean
    error?: string
  }>(response)

  if (!response.ok) {
    throw new Error(data.error || `Catalog search failed (${response.status}).`)
  }

  return {
    results: Array.isArray(data.results) ? data.results : [],
    storageConfigured: data.storageConfigured !== false,
  }
}

export async function fetchCatalogImportProfile(
  externalKey: string,
  signal?: AbortSignal,
): Promise<{
  profile: CatalogImportProfile | null
  storageConfigured: boolean
}> {
  const params = new URLSearchParams({ externalKey })
  const response = await fetch(`/api/catalog/import?${params}`, { signal })
  const data = await readResponseJson<{
    profile?: CatalogImportProfile | null
    storageConfigured?: boolean
    error?: string
  }>(response)

  if (!response.ok) {
    throw new Error(data.error || `Catalog import failed (${response.status}).`)
  }

  return {
    profile: data.profile ?? null,
    storageConfigured: data.storageConfigured !== false,
  }
}

export async function fetchCatalogPassSummaries(
  options: {
    sport: string
    passKind?: CatalogPassKind
    seasonYear?: number
    limit?: number
  },
  signal?: AbortSignal,
): Promise<{
  results: CatalogSearchResult[]
  storageConfigured: boolean
}> {
  const params = new URLSearchParams({
    sport: options.sport,
    passKind: options.passKind ?? 'player',
  })
  if (options.seasonYear !== undefined) {
    params.set('seasonYear', String(options.seasonYear))
  }
  if (options.limit !== undefined) {
    params.set('limit', String(options.limit))
  }

  const response = await fetch(`/api/catalog/candidates?${params}`, { signal })
  const data = await readResponseJson<{
    results?: CatalogSearchResult[]
    storageConfigured?: boolean
    error?: string
  }>(response)

  if (!response.ok) {
    throw new Error(data.error || `Catalog candidates failed (${response.status}).`)
  }

  return {
    results: Array.isArray(data.results) ? data.results : [],
    storageConfigured: data.storageConfigured !== false,
  }
}

export async function fetchCatalogImportProfilesBulk(
  externalKeys: string[],
  signal?: AbortSignal,
  options?: {
    onBatch?: (loaded: number, total: number) => void
  },
): Promise<{
  profiles: CatalogImportProfile[]
  storageConfigured: boolean
}> {
  const keys = [...new Set(externalKeys.map((key) => key.trim()).filter(Boolean))]
  if (keys.length === 0) {
    return { profiles: [], storageConfigured: true }
  }

  const batches = chunkArray(keys, BULK_PROFILE_KEYS_MAX_REQUEST)
  const profiles: CatalogImportProfile[] = []
  let storageConfigured = true
  let keysLoaded = 0

  for (let waveStart = 0; waveStart < batches.length; waveStart += CATALOG_BULK_FETCH_CONCURRENCY) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const wave = batches.slice(waveStart, waveStart + CATALOG_BULK_FETCH_CONCURRENCY)
    const results = await Promise.all(
      wave.map((batchKeys) => fetchCatalogImportProfilesBulkBatch(batchKeys, signal)),
    )

    for (const result of results) {
      if (result.storageConfigured === false) {
        storageConfigured = false
      }
      profiles.push(...result.profiles)
    }

    keysLoaded += wave.reduce((sum, batch) => sum + batch.length, 0)
    options?.onBatch?.(Math.min(keysLoaded, keys.length), keys.length)
  }

  return { profiles, storageConfigured }
}

export async function fetchCatalogSeasonYears(
  options: {
    sport: string
    passKind?: CatalogPassKind
  },
  signal?: AbortSignal,
): Promise<{
  seasonYears: CatalogSeasonYearOption[]
  storageConfigured: boolean
}> {
  const params = new URLSearchParams({
    sport: options.sport,
    passKind: options.passKind ?? 'player',
  })

  const response = await fetch(`/api/catalog/season-years?${params}`, { signal })
  const data = await readResponseJson<{
    seasonYears?: CatalogSeasonYearOption[]
    storageConfigured?: boolean
    error?: string
  }>(response)

  if (!response.ok) {
    throw new Error(data.error || `Catalog season years failed (${response.status}).`)
  }

  return {
    seasonYears: Array.isArray(data.seasonYears) ? data.seasonYears : [],
    storageConfigured: data.storageConfigured !== false,
  }
}

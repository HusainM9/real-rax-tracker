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

export async function searchCatalog(query: string, signal?: AbortSignal): Promise<{
  results: CatalogSearchResult[]
  storageConfigured: boolean
}> {
  const params = new URLSearchParams({ q: query, limit: '24' })
  const response = await fetch(`/api/catalog/search?${params}`, { signal })
  const data = (await response.json()) as {
    results?: CatalogSearchResult[]
    storageConfigured?: boolean
    error?: string
  }

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
  const data = (await response.json()) as {
    profile?: CatalogImportProfile | null
    storageConfigured?: boolean
    error?: string
  }

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

  const response = await fetch(`/api/catalog/candidates?${params}`, { signal })
  const data = (await response.json()) as {
    results?: CatalogSearchResult[]
    storageConfigured?: boolean
    error?: string
  }

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
): Promise<{
  profiles: CatalogImportProfile[]
  storageConfigured: boolean
}> {
  const keys = [...new Set(externalKeys.map((key) => key.trim()).filter(Boolean))]
  if (keys.length === 0) {
    return { profiles: [], storageConfigured: true }
  }

  const BULK_KEYS_PER_REQUEST = 200
  const profiles: CatalogImportProfile[] = []
  let storageConfigured = true

  for (let index = 0; index < keys.length; index += BULK_KEYS_PER_REQUEST) {
    const batchKeys = keys.slice(index, index + BULK_KEYS_PER_REQUEST)
    const response = await fetch('/api/catalog/candidates-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalKeys: batchKeys }),
      signal,
    })
    const data = (await response.json()) as {
      profiles?: CatalogImportProfile[]
      storageConfigured?: boolean
      error?: string
    }

    if (!response.ok) {
      throw new Error(data.error || `Catalog bulk import failed (${response.status}).`)
    }

    if (data.storageConfigured === false) {
      storageConfigured = false
    }
    if (Array.isArray(data.profiles)) {
      profiles.push(...data.profiles)
    }
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
  const data = (await response.json()) as {
    seasonYears?: CatalogSeasonYearOption[]
    storageConfigured?: boolean
    error?: string
  }

  if (!response.ok) {
    throw new Error(data.error || `Catalog season years failed (${response.status}).`)
  }

  return {
    seasonYears: Array.isArray(data.seasonYears) ? data.seasonYears : [],
    storageConfigured: data.storageConfigured !== false,
  }
}


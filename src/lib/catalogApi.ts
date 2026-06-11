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


/**
 * Types and limits shared by the browser and the daily RAX backfill route. Kept free of imports so
 * the client bundle does not pull in the server-only Real client or Supabase store.
 */

/**
 * Prefer Real's `info.total` when every returned day was kept (matches Real's season series).
 * After season-window filtering removes leaked prior-season days, use the filtered sum instead.
 */
export function resolveBaseRaxTotal(input: {
  rowSum: number
  infoTotal?: unknown
  filteredOutOfSeason: boolean
}): number {
  const infoTotal = Number(input.infoTotal)
  if (
    !input.filteredOutOfSeason &&
    Number.isFinite(infoTotal) &&
    infoTotal > 0
  ) {
    return infoTotal
  }
  return input.rowSum
}


/** One pass to backfill. `sportRaw` is the canonical slug from the pass list (`fc`, `nba`, …). */
export type EarningsBackfillPass = {
  externalKey: string
  entityId: number
  passKind: 'player' | 'team'
  sportRaw: string
  seasonYear: number
  seasonLabel: string
  name: string
  rarityLabel?: string
}

export type EarningsBackfillDailyRow = {
  claimDay: string
  /** Base RAX, before any OTD/rarity multiplier. */
  baseRaxEarned: number
  playerBoxScoreId?: number | null
}

export type EarningsBackfillPassResult = {
  externalKey: string
  source: 'cache' | 'real'
  rows: EarningsBackfillDailyRow[]
  /** Rows already in the catalog before this run. */
  cachedRowCount: number
  /** Rows this run added relative to the cache. */
  newRowCount: number
}

export type EarningsBackfillFailure = {
  externalKey: string
  name: string
  message: string
  kind: string
}

export type EarningsBackfillStats = {
  requested: number
  cacheHits: number
  fetched: number
  /** Upstream Real requests actually issued (includes sport-slug retries). */
  upstreamRequests: number
  passesWithoutEarnings: number
  rowsWritten: number
  passesWritten: number
  cacheConfigured: boolean
}

/**
 * Passes per HTTP request. ~235 Legendary+ passes for the largest verified account would never
 * finish inside one serverless invocation, so the client sends batches this size and reports
 * progress between them. Kept modest so default upstream concurrency (2) stays well under Real's
 * rate limit — override via options on the client fetch helper.
 */
export const REAL_EARNINGS_PASSES_MAX_REQUEST = 10

/**
 * Batches in flight from the browser. Each one occupies a serverless invocation that itself runs
 * REAL_IMPORT_CONCURRENCY upstream calls. Default 1 ⇒ ~2 concurrent Real requests.
 */
export const REAL_EARNINGS_BATCH_CONCURRENCY = 1

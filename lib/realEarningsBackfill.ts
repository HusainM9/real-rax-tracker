import { RealApiError, type RealPassEarnings, type RealPassEarningsQuery } from './realApi'
import { parseRealAppToolsBaseDailyRows } from './realAppToolsPaste'
import {
  REAL_EARNINGS_PASSES_MAX_REQUEST,
  resolveBaseRaxTotal,
  type EarningsBackfillDailyRow,
  type EarningsBackfillFailure,
  type EarningsBackfillPass,
  type EarningsBackfillPassResult,
  type EarningsBackfillStats,
} from './realEarningsShared'
import { realRequestSportSlugs } from './realPassScan'
import { runWithConcurrency } from './runWithConcurrency'
import {
  canonicalCatalogPassMetadata,
  catalogExternalKeyCandidates,
  filterDailyRowsToPassSeason,
  normalizeSportForSeasonWindow,
} from './seasonClaimWindow'
import {
  fetchCatalogImportProfilesBulk,
  meowbotCatalogConfigured,
  upsertCatalogDailyEarnings,
  upsertCatalogPasses,
  type CatalogImportProfile,
  type CatalogPassInput,
} from './meowbotCatalogStore'

export type EarningsBackfillResult = {
  passes: EarningsBackfillPassResult[]
  failures: EarningsBackfillFailure[]
  stats: EarningsBackfillStats
}

export type EarningsBackfillDeps = {
  fetchEarnings: (query: RealPassEarningsQuery) => Promise<RealPassEarnings>
  loadCachedProfiles?: (
    externalKeys: string[],
  ) => Promise<{ profiles: CatalogImportProfile[]; storageConfigured: boolean }>
  savePasses?: (passes: CatalogPassInput[]) => Promise<number>
  saveDailyEarnings?: (
    rows: Array<EarningsBackfillDailyRow & { externalKey: string }>,
    options?: { replaceExternalKeys?: string[] },
  ) => Promise<number>
  concurrency?: number
  /** Cached passes older than this are refetched so newly claimed days appear. */
  cacheTtlMs?: number
  now?: () => number
}

function seasonScopedDailyRows(
  rows: EarningsBackfillDailyRow[],
  pass: EarningsBackfillPass,
): { rows: EarningsBackfillDailyRow[]; catalogPass: CatalogPassInput; totalBaseRax: number; filteredOutOfSeason: boolean } {
  const catalogPass = catalogPassInput(pass)
  const filtered = filterDailyRowsToPassSeason(
    rows,
    catalogPass.seasonYear,
    catalogPass.sport,
    catalogPass.seasonLabel,
  )
  const filteredOutOfSeason = filtered.length < rows.length
  const rowSum = filtered.reduce((sum, row) => sum + row.baseRaxEarned, 0)
  return {
    rows: filtered,
    catalogPass,
    filteredOutOfSeason,
    totalBaseRax: rowSum,
  }
}

const DEFAULT_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const DEFAULT_CONCURRENCY = 2

export { REAL_EARNINGS_PASSES_MAX_REQUEST }
export type {
  EarningsBackfillDailyRow,
  EarningsBackfillFailure,
  EarningsBackfillPass,
  EarningsBackfillPassResult,
}

export function resolveEarningsCacheTtlMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const hours = Number(env.REAL_EARNINGS_CACHE_TTL_HOURS)
  if (Number.isFinite(hours) && hours >= 0) return Math.floor(hours * 60 * 60 * 1000)
  return DEFAULT_CACHE_TTL_MS
}

function catalogPassInput(pass: EarningsBackfillPass): CatalogPassInput {
  const canonical = canonicalCatalogPassMetadata({
    entityId: pass.entityId,
    sport: pass.sportRaw,
    seasonYear: pass.seasonYear,
    seasonLabel: pass.seasonLabel,
  })
  return {
    externalKey: canonical.externalKey,
    entityId: pass.entityId,
    passKind: pass.passKind,
    sport: normalizeSportForSeasonWindow(pass.sportRaw),
    seasonYear: canonical.seasonYear,
    seasonLabel: canonical.seasonLabel,
    name: pass.name,
    rarityLabel: pass.rarityLabel,
  }
}

function cacheLookupKeys(pass: EarningsBackfillPass): string[] {
  return catalogExternalKeyCandidates({
    entityId: pass.entityId,
    sport: pass.sportRaw,
    seasonYear: pass.seasonYear,
    seasonLabel: pass.seasonLabel,
  })
}

function isFresh(profile: CatalogImportProfile, nowMs: number, ttlMs: number): boolean {
  const cachedAt = Date.parse(profile.sourceUpdatedAt ?? profile.cachedAt ?? '')
  if (!Number.isFinite(cachedAt)) return false
  return nowMs - cachedAt < ttlMs
}

function profileRows(profile: CatalogImportProfile): EarningsBackfillDailyRow[] {
  return profile.rows.map((row) => ({
    claimDay: row.claimDay,
    baseRaxEarned: row.baseRaxEarned,
    playerBoxScoreId: row.playerBoxScoreId ?? null,
  }))
}

function errorKind(error: unknown): string {
  return error instanceof RealApiError ? error.kind : 'unknown'
}

/**
 * Fetches one pass's daily earnings, trying each candidate sport slug in turn. A 404 means the
 * slug (or the pass) is unknown to Real, so the next candidate is tried; anything else propagates.
 */
async function fetchPassEarnings(
  pass: EarningsBackfillPass,
  deps: EarningsBackfillDeps,
  slugCache: Map<string, string>,
  onRequest: () => void,
): Promise<RealPassEarnings | null> {
  const cachedSlug = slugCache.get(pass.sportRaw)
  const slugs = cachedSlug ? [cachedSlug] : realRequestSportSlugs(pass.sportRaw)
  // Real's path season is start-year for NFL/NHL/CFB/FC — use canonicalized year, not a stale
  // end-year catalog key left over from the pre-reclassification encoding.
  const season = catalogPassInput(pass).seasonYear

  for (const sport of slugs) {
    try {
      onRequest()
      const earnings = await deps.fetchEarnings({
        sport,
        season,
        entityType: pass.passKind,
        entityId: pass.entityId,
      })
      slugCache.set(pass.sportRaw, sport)
      return earnings
    } catch (error) {
      if (error instanceof RealApiError && error.kind === 'not_found') continue
      throw error
    }
  }

  // Every candidate 404'd: treat the pass as having no earnings series rather than as an error.
  return null
}

/**
 * Cache-first per-day earnings backfill. Daily earnings are base RAX and user independent, so the
 * shared catalog serves every owner of the same entity/season/sport; Real is only called for passes
 * that are missing or stale, and every fetch is written back.
 *
 * A single pass failing never fails the batch — it lands in `failures` and stays retryable. An
 * expired bot session is the exception: it would fail every pass, so it propagates.
 */
export async function backfillRealPassEarnings(
  passes: EarningsBackfillPass[],
  deps: EarningsBackfillDeps,
): Promise<EarningsBackfillResult> {
  const nowMs = deps.now?.() ?? Date.now()
  const ttlMs = deps.cacheTtlMs ?? resolveEarningsCacheTtlMs()
  const results: EarningsBackfillPassResult[] = []
  const failures: EarningsBackfillFailure[] = []
  let upstreamRequests = 0
  let cacheHits = 0

  if (passes.length === 0) {
    return {
      passes: results,
      failures,
      stats: {
        requested: 0,
        cacheHits: 0,
        fetched: 0,
        upstreamRequests: 0,
        passesWithoutEarnings: 0,
        rowsWritten: 0,
        passesWritten: 0,
        cacheConfigured: Boolean(deps.loadCachedProfiles),
      },
    }
  }

  const lookupKeys = new Map(passes.map((pass) => [pass.externalKey, cacheLookupKeys(pass)]))
  let profilesByKey = new Map<string, CatalogImportProfile>()
  let cacheConfigured = false

  if (deps.loadCachedProfiles) {
    const allKeys = [...new Set([...lookupKeys.values()].flat())]
    const cached = await deps.loadCachedProfiles(allKeys)
    cacheConfigured = cached.storageConfigured
    profilesByKey = new Map(cached.profiles.map((profile) => [profile.externalKey, profile]))
  }

  const toFetch: EarningsBackfillPass[] = []

  for (const pass of passes) {
    const candidates = lookupKeys.get(pass.externalKey) ?? []
    const profiles = candidates
      .map((key) => profilesByKey.get(key))
      .filter((profile): profile is CatalogImportProfile => Boolean(profile))
    const withRows = profiles.find((profile) => profile.rows.length > 0)
    const knownEmpty = profiles.find((profile) => profile.hasEarnings === false)
    const usable = withRows ?? knownEmpty

    if (usable && isFresh(usable, nowMs, ttlMs)) {
      const cachedRows = withRows ? profileRows(withRows) : []
      // Profiles may still contain prior-season days from merge-only upserts; trim before serving.
      const { rows } = seasonScopedDailyRows(cachedRows, pass)
      cacheHits += 1
      results.push({
        externalKey: pass.externalKey,
        source: 'cache',
        rows,
        cachedRowCount: cachedRows.length,
        newRowCount: 0,
      })
      continue
    }

    toFetch.push(pass)
  }

  const fetchedPasses: CatalogPassInput[] = []
  const fetchedRows: Array<EarningsBackfillDailyRow & { externalKey: string }> = []
  const slugCache = new Map<string, string>()
  let authError: unknown = null

  await runWithConcurrency(toFetch, deps.concurrency ?? DEFAULT_CONCURRENCY, async (pass) => {
    if (authError) return

    const candidates = lookupKeys.get(pass.externalKey) ?? []
    const cachedProfile = candidates
      .map((key) => profilesByKey.get(key))
      .find((profile): profile is CatalogImportProfile => Boolean(profile))
    const cachedRowCount = cachedProfile?.rows.length ?? 0

    try {
      const earnings = await fetchPassEarnings(pass, deps, slugCache, () => {
        upstreamRequests += 1
      })
      const parsed = parseRealAppToolsBaseDailyRows(earnings?.rows ?? [])
      const parsedRows: EarningsBackfillDailyRow[] = parsed.rows.map((row) => ({
        claimDay: row.claimDay,
        baseRaxEarned: row.baseRaxEarned,
        playerBoxScoreId: row.playerBoxScoreId,
      }))
      const scoped = seasonScopedDailyRows(parsedRows, pass)
      const totalBaseRax = resolveBaseRaxTotal({
        rowSum: scoped.totalBaseRax,
        infoTotal: earnings?.info?.total,
        filteredOutOfSeason: scoped.filteredOutOfSeason,
      })

      // Stored as base RAX. The rarity/OTD multiplier is applied locally by computeOtdRax so one
      // cache entry serves every owner regardless of their copy's rarity.
      fetchedPasses.push({
        ...scoped.catalogPass,
        hasEarnings: scoped.rows.length > 0,
        totalBaseRax,
        sourceUpdatedAt: new Date(nowMs).toISOString(),
      })
      for (const row of scoped.rows) {
        fetchedRows.push({ ...row, externalKey: scoped.catalogPass.externalKey })
      }

      const cachedDays = new Set(cachedProfile?.rows.map((row) => row.claimDay) ?? [])
      results.push({
        externalKey: pass.externalKey,
        source: 'real',
        rows: scoped.rows,
        cachedRowCount,
        newRowCount: scoped.rows.filter((row) => !cachedDays.has(row.claimDay)).length,
      })
    } catch (error) {
      if (error instanceof RealApiError && error.kind === 'auth') {
        authError = error
        return
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        authError = error
        return
      }
      failures.push({
        externalKey: pass.externalKey,
        name: pass.name,
        message: error instanceof Error ? error.message : 'Could not fetch daily earnings.',
        kind: errorKind(error),
      })
    }
  })

  if (authError) throw authError

  let passesWritten = 0
  let rowsWritten = 0
  if (fetchedPasses.length > 0 && deps.savePasses && deps.saveDailyEarnings) {
    passesWritten = await deps.savePasses(fetchedPasses)
    // Replace every fetched key (including empty series) so stale prior-season days are cleared.
    rowsWritten = await deps.saveDailyEarnings(fetchedRows, {
      replaceExternalKeys: fetchedPasses.map((pass) => pass.externalKey),
    })
  }

  return {
    passes: results,
    failures,
    stats: {
      requested: passes.length,
      cacheHits,
      fetched: toFetch.length - failures.length,
      upstreamRequests,
      passesWithoutEarnings: results.filter((result) => result.rows.length === 0).length,
      rowsWritten,
      passesWritten,
      cacheConfigured,
    },
  }
}

/** Default catalog-backed dependencies; cache reads/writes are skipped when Supabase is absent. */
export function catalogEarningsBackfillDeps(
  fetchEarnings: EarningsBackfillDeps['fetchEarnings'],
  options: { concurrency?: number } = {},
): EarningsBackfillDeps {
  if (!meowbotCatalogConfigured()) {
    return { fetchEarnings, concurrency: options.concurrency }
  }

  return {
    fetchEarnings,
    concurrency: options.concurrency,
    loadCachedProfiles: (externalKeys) => fetchCatalogImportProfilesBulk(externalKeys),
    savePasses: (passes) => upsertCatalogPasses(passes),
    saveDailyEarnings: (rows, options) =>
      upsertCatalogDailyEarnings(
        rows.map((row) => ({
          externalKey: row.externalKey,
          claimDay: row.claimDay,
          baseRaxEarned: row.baseRaxEarned,
          playerBoxScoreId: row.playerBoxScoreId ?? null,
        })),
        options,
      ),
  }
}

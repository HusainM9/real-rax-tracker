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
  resolveCatalogPassSeasonYear,
  resolvePassSeasonDateWindow,
  sportSkipsClaimDaySeasonFilter,
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
const HISTORICAL_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SEASON_SETTLE_MS = 14 * 24 * 60 * 60 * 1000
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
  // The collection endpoint may use a start-year beside an authoritative split label even for
  // catalog end-year sports (for example CBB 2025 + "2025-26"). Resolve the label before applying
  // catalog repair rules so we do not accidentally load the real prior-season key.
  const resolvedSeasonYear = resolveCatalogPassSeasonYear(
    pass.seasonYear,
    pass.seasonLabel,
    pass.sportRaw,
  )
  const canonical = canonicalCatalogPassMetadata({
    entityId: pass.entityId,
    sport: pass.sportRaw,
    seasonYear: resolvedSeasonYear,
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
    avatar: pass.avatar,
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

function isFresh(
  profile: CatalogImportProfile,
  pass: EarningsBackfillPass,
  nowMs: number,
  ttlMs: number,
): boolean {
  const cachedAt = Date.parse(profile.sourceUpdatedAt ?? profile.cachedAt ?? '')
  if (!Number.isFinite(cachedAt)) return false
  if (ttlMs === 0) return false

  let effectiveTtlMs = ttlMs
  if (!sportSkipsClaimDaySeasonFilter(pass.sportRaw)) {
    const window = resolvePassSeasonDateWindow(pass.seasonYear, pass.sportRaw, pass.seasonLabel)
    const seasonEnd = window ? Date.parse(`${window.end}T23:59:59.999Z`) : Number.NaN
    if (Number.isFinite(seasonEnd) && nowMs - seasonEnd > SEASON_SETTLE_MS) {
      // Completed seasons no longer accumulate daily rows. Keeping them warm for a month avoids
      // repeatedly asking Real for immutable history while still allowing late corrections.
      effectiveTtlMs = Math.max(effectiveTtlMs, HISTORICAL_CACHE_TTL_MS)
    }
  }
  return nowMs - cachedAt < effectiveTtlMs
}

function profileRows(profile: CatalogImportProfile): EarningsBackfillDailyRow[] {
  return profile.rows.map((row) => ({
    claimDay: row.claimDay,
    baseRaxEarned: row.baseRaxEarned,
    playerBoxScoreId: row.playerBoxScoreId ?? null,
  }))
}

function profileMatchesPassSeason(
  profile: CatalogImportProfile,
  pass: EarningsBackfillPass,
): boolean {
  const profileWindow = resolvePassSeasonDateWindow(
    profile.seasonYear,
    profile.sport,
    profile.seasonLabel,
  )
  const passWindow = resolvePassSeasonDateWindow(
    pass.seasonYear,
    pass.sportRaw,
    pass.seasonLabel,
  )
  if (profileWindow && passWindow) {
    return profileWindow.start === passWindow.start && profileWindow.end === passWindow.end
  }
  return profile.externalKey === pass.externalKey
}

function selectUsableCachedProfile(
  profiles: CatalogImportProfile[],
  pass: EarningsBackfillPass,
): { profile: CatalogImportProfile; cachedRows: EarningsBackfillDailyRow[]; rows: EarningsBackfillDailyRow[] } | null {
  const matchingProfiles = profiles.filter((profile) => profileMatchesPassSeason(profile, pass))
  for (const profile of matchingProfiles) {
    const cachedRows = profileRows(profile)
    const { rows } = seasonScopedDailyRows(cachedRows, pass)
    if (rows.length > 0) return { profile, cachedRows, rows }
  }

  const knownEmpty = matchingProfiles.find((profile) => profile.hasEarnings === false)
  return knownEmpty ? { profile: knownEmpty, cachedRows: profileRows(knownEmpty), rows: [] } : null
}

function selectMatchingCachedProfile(
  profiles: CatalogImportProfile[],
  pass: EarningsBackfillPass,
): CatalogImportProfile | undefined {
  return profiles.find((profile) => profileMatchesPassSeason(profile, pass))
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
  const catalogPass = catalogPassInput(pass)
  // Real's NHL endpoints disagree: pass listings use end-year (2025 = 2024-25), while
  // /userpassearnings uses start-year (2024 = 2024-25). Other sports use their canonical year.
  const season =
    normalizeSportForSeasonWindow(pass.sportRaw) === 'NHL'
      ? catalogPass.seasonYear - 1
      : catalogPass.seasonYear

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
    const usable = selectUsableCachedProfile(profiles, pass)

    if (usable && isFresh(usable.profile, pass, nowMs, ttlMs)) {
      cacheHits += 1
      results.push({
        externalKey: pass.externalKey,
        source: 'cache',
        rows: usable.rows,
        cachedRowCount: usable.cachedRows.length,
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
    const candidateProfiles = candidates
      .map((key) => profilesByKey.get(key))
      .filter((profile): profile is CatalogImportProfile => Boolean(profile))
    const cachedProfile = selectMatchingCachedProfile(candidateProfiles, pass)
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
  options: { concurrency?: number; cacheTtlMs?: number } = {},
): EarningsBackfillDeps {
  if (!meowbotCatalogConfigured()) {
    return {
      fetchEarnings,
      concurrency: options.concurrency,
      cacheTtlMs: options.cacheTtlMs,
    }
  }

  return {
    fetchEarnings,
    concurrency: options.concurrency,
    cacheTtlMs: options.cacheTtlMs,
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

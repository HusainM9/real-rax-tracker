import { parseRealAppToolsBaseDailyRows } from './realAppToolsPaste'
import {
  RealApiError,
  type RealPassEarnings,
  type RealPassEarningsQuery,
  type RealShopEarningsTotalItem,
  type RealShopEarningsTotalPage,
  type RealShopEarningsTotalQuery,
} from './realApi'
import { resolveBaseRaxTotal } from './realEarningsShared'
import { canonicalRealSport, realRequestSportSlugs } from './realPassScan'
import { runWithConcurrency } from './runWithConcurrency'
import {
  canonicalCatalogPassMetadata,
  expectedSeasonLabelFromYear,
  filterDailyRowsToPassSeason,
  normalizeSportForSeasonWindow,
} from './seasonClaimWindow'
import {
  meowbotCatalogConfigured,
  upsertCatalogDailyEarnings,
  upsertCatalogPasses,
  type CatalogDailyEarningInput,
  type CatalogPassInput,
  type CatalogPassKind,
} from './meowbotCatalogStore'

/** Real shop earningstotal page size (confirmed). */
export const SHOP_EARNINGS_PAGE_SIZE = 20

/**
 * Safe default pages per admin chunk. Each page triggers up to 20 earnings fetches + delayMs
 * between calls (~30–60s/page at 1500ms), and log events only arrive when the chunk HTTP
 * response returns — so keep this at 1. The Admin UI loops until done.
 */
export const DEFAULT_SHOP_CRAWL_MAX_PAGES = 1

/** Cap so a single serverless invocation cannot run unbounded. */
export const MAX_SHOP_CRAWL_MAX_PAGES = 5

/** Delay between Real calls (pages + per-entity earnings). Override with REAL_SHOP_CRAWL_DELAY_MS. */
export const DEFAULT_SHOP_CRAWL_DELAY_MS = 1500

/** Earnings fetches in parallel within a page. Default 1 = sequential (slow / 429-safe). */
export const DEFAULT_SHOP_CRAWL_EARNINGS_CONCURRENCY = 1

/** Live sports Real path slugs (UFC is opt-in via includeUfc). */
export const LIVE_SHOP_CRAWL_SPORT_SLUGS = [
  'nba',
  'wnba',
  'nfl',
  'ncaaf',
  'mlb',
  'nhl',
  'ncaam',
  'golf',
  'soccer',
] as const

export type ShopCrawlEntityType = CatalogPassKind

export type ShopCrawlJob = {
  /** Real path slug used in /userpassshop/... */
  realSport: string
  season: number
  entityType: ShopCrawlEntityType
}

export type ShopCrawlCursor = {
  jobIndex: number
  before: number
  sport: string
  season: number
  entityType: ShopCrawlEntityType
}

export type ShopCrawlSkip = {
  sport: string
  season: number
  entityType: ShopCrawlEntityType
  reason: string
}

export type ShopCrawlChunkInput = {
  sports?: string[]
  seasons: number[]
  entityTypes?: ShopCrawlEntityType[]
  includeUfc?: boolean
  before?: number
  jobIndex?: number
  maxPages?: number
  /** Hard stop on `before` within the current job (optional alternative to maxPages). */
  maxBefore?: number
  delayMs?: number
  /** Parallel earnings fetches within a shop page (default 1). */
  earningsConcurrency?: number
}

export type ShopCrawlLogEventType =
  | 'chunk_start'
  | 'page_fetched'
  | 'page_summary'
  | 'earnings_failure'
  | 'job_skipped'
  | 'page_failed'
  | 'chunk_complete'

/** Structured activity-log lines for the Admin crawl UI (one meaningful event each). */
export type ShopCrawlLogEvent = {
  type: ShopCrawlLogEventType
  message: string
  sport?: string
  season?: number
  entityType?: ShopCrawlEntityType
  before?: number
  itemCount?: number
  entityId?: number
  name?: string
  dailyRows?: number
  total?: number
  ok?: number
  failed?: number
  upserted?: number
  dailyRowsUpserted?: number
  status?: number
  rateLimited?: boolean
  reason?: string
  done?: boolean
  jobsTotal?: number
  maxPages?: number
  jobIndex?: number
}

export type ShopCrawlChunkResult = {
  upserted: number
  pagesFetched: number
  earningsFetched: number
  earningsFailed: number
  dailyRowsUpserted: number
  nextBefore: number
  done: boolean
  cursor: ShopCrawlCursor
  jobsTotal: number
  skipped: ShopCrawlSkip[]
  failures: string[]
  /** Append these lines in the Admin activity log (newest last). */
  log: ShopCrawlLogEvent[]
}

export type ShopCrawlDeps = {
  fetchPage: (query: RealShopEarningsTotalQuery) => Promise<RealShopEarningsTotalPage>
  fetchEarnings: (query: RealPassEarningsQuery) => Promise<RealPassEarnings>
  savePasses?: (passes: CatalogPassInput[]) => Promise<number>
  saveDailyEarnings?: (
    rows: CatalogDailyEarningInput[],
    options?: { replaceExternalKeys?: string[] },
  ) => Promise<number>
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  now?: () => string
  signal?: AbortSignal
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

export function resolveShopCrawlDelayMs(
  env: Record<string, string | undefined> = process.env,
): number {
  return readPositiveInt(env.REAL_SHOP_CRAWL_DELAY_MS, DEFAULT_SHOP_CRAWL_DELAY_MS)
}

export function resolveShopCrawlMaxPages(
  env: Record<string, string | undefined> = process.env,
): number {
  return Math.min(
    MAX_SHOP_CRAWL_MAX_PAGES,
    readPositiveInt(env.REAL_SHOP_CRAWL_MAX_PAGES, DEFAULT_SHOP_CRAWL_MAX_PAGES),
  )
}

export function resolveShopCrawlEarningsConcurrency(
  env: Record<string, string | undefined> = process.env,
): number {
  return Math.min(
    4,
    readPositiveInt(env.REAL_SHOP_CRAWL_EARNINGS_CONCURRENCY, DEFAULT_SHOP_CRAWL_EARNINGS_CONCURRENCY),
  )
}

/**
 * Map UI / app sport labels onto Real shop path slugs.
 * Prefers confirmed slugs: `ncaam` (not cbb), `soccer` (not fc).
 */
export function toRealShopSportSlug(sport: string): string {
  const raw = sport.trim().toLowerCase()
  if (!raw || raw === 'other' || raw === 'ufc') {
    return raw === 'ufc' ? 'ufc' : ''
  }
  if (raw === 'cbb' || raw === 'ncaab' || raw === 'ncaa-mens-basketball') return 'ncaam'
  if (raw === 'fc' || raw === 'soccer') return 'soccer'
  if (raw === 'cfb' || raw === 'ncaafootball' || raw === 'ncaa-football') return 'ncaaf'

  const canonical = canonicalRealSport(raw)
  const preferred = realRequestSportSlugs(canonical)[0]
  return preferred || canonical
}

export function resolveShopCrawlSports(input: {
  sports?: string[]
  includeUfc?: boolean
}): string[] {
  const fromInput = (input.sports ?? [])
    .map(toRealShopSportSlug)
    .filter((sport) => sport.length > 0 && sport !== 'other')

  const liveFromInput = [...new Set(fromInput.filter((sport) => sport !== 'ufc'))]
  // Client sends sports:['ufc'] for UFC-only; keep that from expanding to all live sports.
  const ufcOnlyRequest = fromInput.includes('ufc') && liveFromInput.length === 0
  const includeUfc = Boolean(input.includeUfc) || ufcOnlyRequest

  const base =
    liveFromInput.length > 0
      ? liveFromInput
      : ufcOnlyRequest
        ? ([] as string[])
        : [...LIVE_SHOP_CRAWL_SPORT_SLUGS]

  if (includeUfc && !base.includes('ufc')) {
    base.push('ufc')
  }
  if (!includeUfc) {
    return base.filter((sport) => sport !== 'ufc')
  }
  return base
}

/**
 * Entity types for a Real shop path. UFC fighters use Real's `entity/team`
 * section (player / fighter shop sections are empty or 400).
 */
export function entityTypesForShopSport(
  realSport: string,
  entityTypes: ShopCrawlEntityType[],
): ShopCrawlEntityType[] {
  if (realSport === 'ufc') return ['team']
  return entityTypes
}

export function buildShopCrawlJobs(input: {
  sports?: string[]
  seasons: number[]
  entityTypes?: ShopCrawlEntityType[]
  includeUfc?: boolean
}): ShopCrawlJob[] {
  const sports = resolveShopCrawlSports(input)
  const seasons = [...new Set(input.seasons.filter((season) => Number.isInteger(season) && season > 0))]
  const liveSports = sports.filter((sport) => sport !== 'ufc')
  const hasUfc = sports.includes('ufc')

  let entityTypes: ShopCrawlEntityType[] =
    input.entityTypes && input.entityTypes.length > 0
      ? [...new Set(input.entityTypes)]
      : []

  // Live sports need player and/or team. UFC-only may omit toggles — default to team.
  if (entityTypes.length === 0) {
    if (liveSports.length > 0) {
      entityTypes = ['player', 'team']
    } else if (hasUfc) {
      entityTypes = ['team']
    }
  }

  const jobs: ShopCrawlJob[] = []
  for (const realSport of sports) {
    const typesForSport = entityTypesForShopSport(realSport, entityTypes)
    for (const season of seasons) {
      for (const entityType of typesForSport) {
        jobs.push({ realSport, season, entityType })
      }
    }
  }
  return jobs
}

function entityIdFromItem(item: RealShopEarningsTotalItem): number | null {
  const nestedEntity =
    item.entity && typeof item.entity === 'object'
      ? (item.entity as { id?: unknown }).id
      : undefined
  for (const candidate of [item.id, nestedEntity, item.entity, item.entityId]) {
    const value = Number(candidate)
    if (Number.isFinite(value) && value > 0) return Math.floor(value)
  }
  return null
}

function passKindFromItem(
  item: RealShopEarningsTotalItem,
  fallback: ShopCrawlEntityType,
): ShopCrawlEntityType {
  const raw = String(item.entityType ?? item.type ?? fallback)
    .trim()
    .toLowerCase()
  return raw === 'team' ? 'team' : 'player'
}

/** Pure mapping: shop item → catalog pass metadata (no dailies, no rarity). */
export function mapShopEarningsItemToCatalogPass(
  item: RealShopEarningsTotalItem,
  job: ShopCrawlJob,
): CatalogPassInput | null {
  const entityId = entityIdFromItem(item)
  if (entityId == null) return null

  const sportRaw = String(item.sport ?? job.realSport).trim() || job.realSport
  const sport = normalizeSportForSeasonWindow(sportRaw)
  const seasonYear = job.season
  const seasonLabel = expectedSeasonLabelFromYear(seasonYear, sport)
  const canonical = canonicalCatalogPassMetadata({
    entityId,
    sport,
    seasonYear,
    seasonLabel,
  })
  const value = Number(item.value)
  const totalBaseRax = Number.isFinite(value) && value > 0 ? value : 0
  const name = String(item.label ?? '').trim() || `Entity ${entityId}`
  // Real's UFC shop uses entity/team, but fighters are player-like for Potential/OTD.
  const passKind =
    normalizeSportForSeasonWindow(sport) === 'UFC'
      ? 'player'
      : passKindFromItem(item, job.entityType)

  return {
    externalKey: canonical.externalKey,
    entityId,
    passKind,
    sport: normalizeSportForSeasonWindow(sport),
    seasonYear: canonical.seasonYear,
    seasonLabel: canonical.seasonLabel,
    name,
    totalBaseRax,
    hasEarnings: totalBaseRax > 0,
  }
}

export type ShopItemEarningsMapped = {
  pass: CatalogPassInput
  dailyRows: CatalogDailyEarningInput[]
}

/**
 * Map a shop item + Real pass-earnings response → catalog pass + season-scoped daily rows.
 * Prefers `info.total` when no days were trimmed by the season window.
 */
export function mapShopItemEarningsToCatalog(
  item: RealShopEarningsTotalItem,
  job: ShopCrawlJob,
  earnings: RealPassEarnings | null,
  sourceUpdatedAt: string,
): ShopItemEarningsMapped | null {
  const basePass = mapShopEarningsItemToCatalogPass(item, job)
  if (!basePass) return null

  const parsed = parseRealAppToolsBaseDailyRows(earnings?.rows ?? [])
  const filtered = filterDailyRowsToPassSeason(
    parsed.rows.map((row) => ({
      claimDay: row.claimDay,
      baseRaxEarned: row.baseRaxEarned,
      playerBoxScoreId: row.playerBoxScoreId,
    })),
    basePass.seasonYear,
    basePass.sport,
    basePass.seasonLabel,
  )
  const filteredOutOfSeason = filtered.length < parsed.rows.length
  const rowSum = filtered.reduce((sum, row) => sum + row.baseRaxEarned, 0)
  const totalBaseRax = resolveBaseRaxTotal({
    rowSum,
    infoTotal: earnings?.info?.total,
    filteredOutOfSeason,
  })
  // Fall back to shop leaderboard value when earnings returned no usable total.
  const resolvedTotal =
    totalBaseRax > 0 ? totalBaseRax : Math.max(0, Number(basePass.totalBaseRax) || 0)

  return {
    pass: {
      ...basePass,
      totalBaseRax: resolvedTotal,
      hasEarnings: filtered.length > 0 || resolvedTotal > 0,
      sourceUpdatedAt,
    },
    dailyRows: filtered.map((row) => ({
      externalKey: basePass.externalKey,
      claimDay: row.claimDay,
      baseRaxEarned: row.baseRaxEarned,
      playerBoxScoreId: row.playerBoxScoreId ?? null,
    })),
  }
}

function cursorFor(jobs: ShopCrawlJob[], jobIndex: number, before: number): ShopCrawlCursor {
  const job = jobs[Math.min(jobIndex, Math.max(0, jobs.length - 1))]
  return {
    jobIndex,
    before,
    sport: job?.realSport ?? '',
    season: job?.season ?? 0,
    entityType: job?.entityType ?? 'player',
  }
}

/**
 * Fetch up to `maxPages` shop earningstotal pages, then per-item daily earnings, upserting
 * pass metadata + base dailies (replace-not-merge for fetched keys). Resumable via jobIndex + before.
 */
export async function crawlShopEarningsTotalChunk(
  input: ShopCrawlChunkInput,
  deps: ShopCrawlDeps,
): Promise<ShopCrawlChunkResult> {
  const jobs = buildShopCrawlJobs(input)
  const maxPages = Math.min(
    MAX_SHOP_CRAWL_MAX_PAGES,
    Math.max(1, Math.floor(input.maxPages ?? DEFAULT_SHOP_CRAWL_MAX_PAGES)),
  )
  const maxBefore =
    input.maxBefore != null && Number.isFinite(input.maxBefore) && input.maxBefore >= 0
      ? Math.floor(input.maxBefore)
      : null
  const delayMs = Math.max(0, Math.floor(input.delayMs ?? DEFAULT_SHOP_CRAWL_DELAY_MS))
  const earningsConcurrency = Math.max(
    1,
    Math.min(4, Math.floor(input.earningsConcurrency ?? DEFAULT_SHOP_CRAWL_EARNINGS_CONCURRENCY)),
  )
  const savePasses = deps.savePasses ?? upsertCatalogPasses
  const saveDailyEarnings = deps.saveDailyEarnings ?? upsertCatalogDailyEarnings
  const wait = deps.sleep ?? sleep
  const sourceUpdatedAt = deps.now?.() ?? new Date().toISOString()

  let jobIndex = Math.max(0, Math.floor(input.jobIndex ?? 0))
  let before = Math.max(0, Math.floor(input.before ?? 0))
  let pagesFetched = 0
  let upserted = 0
  let earningsFetched = 0
  let earningsFailed = 0
  let dailyRowsUpserted = 0
  const skipped: ShopCrawlSkip[] = []
  const failures: string[] = []
  const log: ShopCrawlLogEvent[] = []
  let fetchedOnce = false
  // Serialize delays across concurrent earnings workers so "slow crawl" stays paced.
  let paceChain: Promise<void> = Promise.resolve()

  if (jobs.length === 0) {
    const message =
      'No crawl jobs to run. Select at least one sport (or UFC), at least one season, and for live sports choose players and/or teams.'
    log.push({
      type: 'chunk_start',
      message,
      jobsTotal: 0,
      maxPages,
      jobIndex: 0,
      before: 0,
    })
    log.push({
      type: 'chunk_complete',
      message: `Chunk complete: nothing to crawl — ${message}`,
      upserted: 0,
      dailyRowsUpserted: 0,
      ok: 0,
      failed: 0,
      done: true,
      jobIndex: 0,
      before: 0,
    })
    return {
      upserted: 0,
      pagesFetched: 0,
      earningsFetched: 0,
      earningsFailed: 0,
      dailyRowsUpserted: 0,
      nextBefore: 0,
      done: true,
      cursor: { jobIndex: 0, before: 0, sport: '', season: 0, entityType: 'player' },
      jobsTotal: 0,
      skipped,
      failures: [message],
      log,
    }
  }

  const sportsLabel = [...new Set(jobs.map((job) => job.realSport))].join(',') || '(none)'
  const seasonsLabel = [...new Set(jobs.map((job) => job.season))].join(',') || '(none)'
  const entityTypesLabel =
    [...new Set(jobs.map((job) => job.entityType))].join(',') || '(none)'
  log.push({
    type: 'chunk_start',
    message: `Chunk start: ${jobs.length} job(s), sports=[${sportsLabel}], seasons=[${seasonsLabel}], entityTypes=[${entityTypesLabel}], maxPages=${maxPages}, resume jobIndex=${jobIndex} before=${before}, delayMs=${delayMs}, earningsConcurrency=${earningsConcurrency}`,
    jobsTotal: jobs.length,
    maxPages,
    jobIndex,
    before,
  })

  const pace = async () => {
    const run = async () => {
      if (fetchedOnce && delayMs > 0) {
        await wait(delayMs, deps.signal)
      }
      fetchedOnce = true
    }
    const next = paceChain.then(run, run)
    paceChain = next.then(
      () => undefined,
      () => undefined,
    )
    await next
  }

  while (pagesFetched < maxPages && jobIndex < jobs.length) {
    const job = jobs[jobIndex]
    if (!job) break

    if (maxBefore != null && before > maxBefore) {
      jobIndex += 1
      before = 0
      continue
    }

    await pace()

    const pageBefore = before
    let page: RealShopEarningsTotalPage
    try {
      page = await deps.fetchPage({
        sport: job.realSport,
        season: job.season,
        entityType: job.entityType,
        before,
      })
    } catch (error) {
      pagesFetched += 1
      if (error instanceof RealApiError && error.kind === 'auth') {
        throw error
      }
      if (error instanceof RealApiError && error.kind === 'not_found') {
        const reason =
          'Real returned 404 (season/sport may not exist — common for UFC / odd seasons).'
        skipped.push({
          sport: job.realSport,
          season: job.season,
          entityType: job.entityType,
          reason,
        })
        log.push({
          type: 'job_skipped',
          message: `Skipped ${job.realSport}/${job.season}/${job.entityType}: ${reason}`,
          sport: job.realSport,
          season: job.season,
          entityType: job.entityType,
          before: pageBefore,
          status: error.status,
          reason,
        })
        jobIndex += 1
        before = 0
        continue
      }
      const errMsg = error instanceof Error ? error.message : 'Shop crawl page failed'
      const status = error instanceof RealApiError ? error.status : undefined
      const rateLimited = error instanceof RealApiError && error.kind === 'rate_limited'
      failures.push(`${job.realSport}/${job.season}/${job.entityType}@${pageBefore}: ${errMsg}`)
      log.push({
        type: 'page_failed',
        message: `Page failed ${job.realSport}/${job.season}/${job.entityType} before=${pageBefore}: ${errMsg}${
          rateLimited ? ' (rate limited)' : ''
        }${status != null ? ` [${status}]` : ''}`,
        sport: job.realSport,
        season: job.season,
        entityType: job.entityType,
        before: pageBefore,
        status,
        rateLimited,
      })
      jobIndex += 1
      before = 0
      continue
    }

    pagesFetched += 1
    log.push({
      type: 'page_fetched',
      message: `Shop page ${job.realSport}/${job.season}/${job.entityType} before=${pageBefore}: ${page.items.length} item(s)`,
      sport: job.realSport,
      season: job.season,
      entityType: job.entityType,
      before: pageBefore,
      itemCount: page.items.length,
    })

    if (page.items.length === 0) {
      log.push({
        type: 'page_summary',
        message: `Page empty — advancing past ${job.realSport}/${job.season}/${job.entityType}`,
        sport: job.realSport,
        season: job.season,
        entityType: job.entityType,
        before: pageBefore,
        itemCount: 0,
        ok: 0,
        failed: 0,
      })
      jobIndex += 1
      before = 0
      continue
    }

    const pagePasses: CatalogPassInput[] = []
    const pageDailyRows: CatalogDailyEarningInput[] = []
    const replaceKeys: string[] = []
    let pageOk = 0
    let pageFailed = 0
    let authError: unknown = null

    await runWithConcurrency(page.items, earningsConcurrency, async (item) => {
      if (authError) return

      const basePass = mapShopEarningsItemToCatalogPass(item, job)
      if (!basePass) return

      try {
        await pace()
        let earnings: RealPassEarnings | null = null
        try {
          earnings = await deps.fetchEarnings({
            sport: job.realSport,
            season: job.season,
            entityType: job.entityType,
            entityId: basePass.entityId,
          })
        } catch (error) {
          // Unknown entity / season for this slug → empty series (still replace stale dailies).
          if (!(error instanceof RealApiError && error.kind === 'not_found')) throw error
        }
        const mapped = mapShopItemEarningsToCatalog(item, job, earnings, sourceUpdatedAt)
        if (!mapped) return
        pagePasses.push(mapped.pass)
        pageDailyRows.push(...mapped.dailyRows)
        replaceKeys.push(mapped.pass.externalKey)
        earningsFetched += 1
        pageOk += 1
      } catch (error) {
        if (error instanceof RealApiError && error.kind === 'auth') {
          authError = error
          return
        }
        if (error instanceof DOMException && error.name === 'AbortError') {
          authError = error
          return
        }
        // Soft-fail one entity: keep shop totals metadata, do not replace its dailies.
        earningsFailed += 1
        pageFailed += 1
        const errMsg = error instanceof Error ? error.message : 'Earnings fetch failed'
        const status = error instanceof RealApiError ? error.status : undefined
        const rateLimited = error instanceof RealApiError && error.kind === 'rate_limited'
        failures.push(
          `${job.realSport}/${job.season}/${job.entityType}/${basePass.entityId}: ${errMsg}`,
        )
        log.push({
          type: 'earnings_failure',
          message: `Earnings failed ${basePass.entityId} ${basePass.name}: ${errMsg}${
            rateLimited ? ' (rate limited)' : ''
          }${status != null ? ` [${status}]` : ''}`,
          sport: job.realSport,
          season: job.season,
          entityType: job.entityType,
          entityId: basePass.entityId,
          name: basePass.name,
          status,
          rateLimited,
        })
        pagePasses.push({ ...basePass, sourceUpdatedAt })
      }
    })

    if (authError) throw authError

    let pagePassesUpserted = 0
    let pageDailyUpserted = 0
    if (pagePasses.length > 0) {
      pagePassesUpserted = await savePasses(pagePasses)
      upserted += pagePassesUpserted
    }
    if (replaceKeys.length > 0) {
      pageDailyUpserted = await saveDailyEarnings(pageDailyRows, {
        replaceExternalKeys: replaceKeys,
      })
      dailyRowsUpserted += pageDailyUpserted
    }

    log.push({
      type: 'page_summary',
      message: `Page done ${job.realSport}/${job.season}/${job.entityType} before=${pageBefore}: ${pageOk} ok / ${pageFailed} failed, ${pageDailyRows.length} daily row(s), upserted ${pagePassesUpserted} pass(es) / ${pageDailyUpserted} daily row(s)`,
      sport: job.realSport,
      season: job.season,
      entityType: job.entityType,
      before: pageBefore,
      itemCount: page.items.length,
      ok: pageOk,
      failed: pageFailed,
      dailyRows: pageDailyRows.length,
      upserted: pagePassesUpserted,
      dailyRowsUpserted: pageDailyUpserted,
    })

    if (page.items.length < SHOP_EARNINGS_PAGE_SIZE) {
      jobIndex += 1
      before = 0
      continue
    }

    before += SHOP_EARNINGS_PAGE_SIZE
    if (maxBefore != null && before > maxBefore) {
      jobIndex += 1
      before = 0
    }
  }

  const done = jobIndex >= jobs.length
  const cursor = cursorFor(jobs, done ? Math.max(0, jobs.length - 1) : jobIndex, before)
  log.push({
    type: 'chunk_complete',
    message: `Chunk complete: ${pagesFetched} page(s), ${earningsFetched} earnings ok / ${earningsFailed} failed, upserted ${upserted} pass(es) / ${dailyRowsUpserted} daily row(s)${
      done
        ? ' — crawl done'
        : ` — resume jobIndex=${cursor.jobIndex} before=${before} (${cursor.sport}/${cursor.season}/${cursor.entityType})`
    }`,
    upserted,
    dailyRowsUpserted,
    ok: earningsFetched,
    failed: earningsFailed,
    done,
    jobIndex: cursor.jobIndex,
    before,
    sport: cursor.sport,
    season: cursor.season,
    entityType: cursor.entityType,
  })

  return {
    upserted,
    pagesFetched,
    earningsFetched,
    earningsFailed,
    dailyRowsUpserted,
    nextBefore: before,
    done,
    cursor,
    jobsTotal: jobs.length,
    skipped,
    failures,
    log,
  }
}

export function shopCrawlConfigured(): boolean {
  return meowbotCatalogConfigured()
}

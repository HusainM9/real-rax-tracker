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
import { canonicalRealSport, avatarFromRealEntity, realRequestSportSlugs } from './realPassScan'
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
 * between calls; log events only arrive when the chunk HTTP response returns — keep at 1.
 * The Admin UI loops until done.
 */
export const DEFAULT_SHOP_CRAWL_MAX_PAGES = 1

/** Cap so a single serverless invocation cannot run unbounded. */
export const MAX_SHOP_CRAWL_MAX_PAGES = 5

/**
 * Avatars-only chunks skip earnings fetches (1 Real call/page), so a higher page
 * cap is safe and matches the Admin UI default of 15.
 */
export const MAX_AVATAR_SHOP_CRAWL_MAX_PAGES = 15

/**
 * Delay between Real calls (pages + per-entity earnings). Override with REAL_SHOP_CRAWL_DELAY_MS.
 * Keep low for Vercel: 1500ms × 21 calls ≈ 30s+ before any upsert, which exceeds Hobby limits
 * and surfaces as FUNCTION_INVOCATION_FAILED with 0 writes.
 */
export const DEFAULT_SHOP_CRAWL_DELAY_MS = 300

/** Earnings fetches in parallel within a page. Override with REAL_SHOP_CRAWL_EARNINGS_CONCURRENCY. */
export const DEFAULT_SHOP_CRAWL_EARNINGS_CONCURRENCY = 2

/**
 * Soft wall-clock budget per chunk (ms). Stop between pages before the platform kills the
 * invocation. Override with REAL_SHOP_CRAWL_BUDGET_MS. Hobby Edge ≈ 30s; leave headroom.
 */
export const DEFAULT_SHOP_CRAWL_BUDGET_MS = 22_000

/** Minimum remaining budget required to start another shop page. */
export const SHOP_CRAWL_PAGE_RESERVE_MS = 4_000

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
  /** Parallel earnings fetches within a shop page (default 2). */
  earningsConcurrency?: number
  /** Soft wall-clock budget for this chunk (ms). */
  budgetMs?: number
  /**
   * When true, only upsert pass metadata (including `entity.avatar`) from shop pages —
   * skip per-entity earnings fetches. Use to backfill college player faces quickly
   * (Real `/userpasses` omits avatar for ncaam/ncaaf players).
   */
  avatarsOnly?: boolean
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

export function resolveShopCrawlBudgetMs(
  env: Record<string, string | undefined> = process.env,
): number {
  return readPositiveInt(env.REAL_SHOP_CRAWL_BUDGET_MS, DEFAULT_SHOP_CRAWL_BUDGET_MS)
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
  const avatar = avatarFromRealEntity(item.entity)

  return {
    externalKey: canonical.externalKey,
    entityId,
    passKind,
    sport: normalizeSportForSeasonWindow(sport),
    seasonYear: canonical.seasonYear,
    seasonLabel: canonical.seasonLabel,
    name,
    avatar,
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
 * Stops early when the soft wall-clock budget is nearly exhausted so Vercel does not hard-kill
 * the invocation (FUNCTION_INVOCATION_FAILED) before any rows are written.
 */
export async function crawlShopEarningsTotalChunk(
  input: ShopCrawlChunkInput,
  deps: ShopCrawlDeps,
): Promise<ShopCrawlChunkResult> {
  const jobs = buildShopCrawlJobs(input)
  const pageCap = input.avatarsOnly ? MAX_AVATAR_SHOP_CRAWL_MAX_PAGES : MAX_SHOP_CRAWL_MAX_PAGES
  const maxPages = Math.min(
    pageCap,
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
  const budgetMs = Math.max(
    SHOP_CRAWL_PAGE_RESERVE_MS + 1_000,
    Math.floor(input.budgetMs ?? DEFAULT_SHOP_CRAWL_BUDGET_MS),
  )
  const savePasses = deps.savePasses ?? upsertCatalogPasses
  const saveDailyEarnings = deps.saveDailyEarnings ?? upsertCatalogDailyEarnings
  const wait = deps.sleep ?? sleep
  const sourceUpdatedAt = deps.now?.() ?? new Date().toISOString()
  const startedAt = Date.now()
  const timeLeftMs = () => budgetMs - (Date.now() - startedAt)

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
  let stoppedForBudget = false
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
  const avatarsOnly = input.avatarsOnly === true
  log.push({
    type: 'chunk_start',
    message: `Chunk start: ${jobs.length} job(s), sports=[${sportsLabel}], seasons=[${seasonsLabel}], entityTypes=[${entityTypesLabel}], maxPages=${maxPages}, resume jobIndex=${jobIndex} before=${before}, delayMs=${delayMs}, earningsConcurrency=${earningsConcurrency}, budgetMs=${budgetMs}${
      avatarsOnly ? ', avatarsOnly=true (skip earnings)' : ''
    }`,
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

  const flushPage = async (
    pagePasses: CatalogPassInput[],
    pageDailyRows: CatalogDailyEarningInput[],
    replaceKeys: string[],
  ): Promise<{ passes: number; dailies: number }> => {
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
    return { passes: pagePassesUpserted, dailies: pageDailyUpserted }
  }

  while (pagesFetched < maxPages && jobIndex < jobs.length) {
    if (timeLeftMs() < SHOP_CRAWL_PAGE_RESERVE_MS) {
      stoppedForBudget = true
      log.push({
        type: 'page_summary',
        message: `Budget nearly exhausted (${Math.max(0, Math.round(timeLeftMs()))}ms left of ${budgetMs}ms) — ending chunk before another shop page so Vercel does not kill the function.`,
        jobIndex,
        before,
      })
      break
    }

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

    if (avatarsOnly) {
      const pagePasses: CatalogPassInput[] = []
      for (const item of page.items) {
        const basePass = mapShopEarningsItemToCatalogPass(item, job)
        if (!basePass) continue
        pagePasses.push({ ...basePass, sourceUpdatedAt })
      }
      const flushed = await flushPage(pagePasses, [], [])
      log.push({
        type: 'page_summary',
        message: `Page avatars ${job.realSport}/${job.season}/${job.entityType} before=${pageBefore}: ${pagePasses.length} pass(es) with shop metadata/avatars, upserted ${flushed.passes}`,
        sport: job.realSport,
        season: job.season,
        entityType: job.entityType,
        before: pageBefore,
        itemCount: page.items.length,
        ok: pagePasses.length,
        failed: 0,
        upserted: flushed.passes,
        dailyRowsUpserted: 0,
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
      continue
    }

    const pagePasses: CatalogPassInput[] = []
    const pageDailyRows: CatalogDailyEarningInput[] = []
    const replaceKeys: string[] = []
    let pageOk = 0
    let pageFailed = 0
    let authError: unknown = null
    let budgetStop = false

    await runWithConcurrency(page.items, earningsConcurrency, async (item) => {
      if (authError || budgetStop) return

      if (timeLeftMs() < 1_500) {
        budgetStop = true
        return
      }

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

    // Upsert whatever we gathered before returning — critical so a near-timeout still saves rows.
    const flushed = await flushPage(pagePasses, pageDailyRows, replaceKeys)

    if (budgetStop) {
      stoppedForBudget = true
      log.push({
        type: 'page_summary',
        message: `Page partial ${job.realSport}/${job.season}/${job.entityType} before=${pageBefore}: budget stop after ${pageOk} ok / ${pageFailed} failed — upserted ${flushed.passes} pass(es) / ${flushed.dailies} daily row(s). Resume same before to finish the page.`,
        sport: job.realSport,
        season: job.season,
        entityType: job.entityType,
        before: pageBefore,
        itemCount: page.items.length,
        ok: pageOk,
        failed: pageFailed,
        dailyRows: pageDailyRows.length,
        upserted: flushed.passes,
        dailyRowsUpserted: flushed.dailies,
      })
      // Keep the same `before` so the next chunk re-fetches this page (upserts are idempotent).
      break
    }

    log.push({
      type: 'page_summary',
      message: `Page done ${job.realSport}/${job.season}/${job.entityType} before=${pageBefore}: ${pageOk} ok / ${pageFailed} failed, ${pageDailyRows.length} daily row(s), upserted ${flushed.passes} pass(es) / ${flushed.dailies} daily row(s)`,
      sport: job.realSport,
      season: job.season,
      entityType: job.entityType,
      before: pageBefore,
      itemCount: page.items.length,
      ok: pageOk,
      failed: pageFailed,
      dailyRows: pageDailyRows.length,
      upserted: flushed.passes,
      dailyRowsUpserted: flushed.dailies,
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

  const done = !stoppedForBudget && jobIndex >= jobs.length
  const cursor = cursorFor(jobs, done ? Math.max(0, jobs.length - 1) : jobIndex, before)
  log.push({
    type: 'chunk_complete',
    message: `Chunk complete: ${pagesFetched} page(s), ${earningsFetched} earnings ok / ${earningsFailed} failed, upserted ${upserted} pass(es) / ${dailyRowsUpserted} daily row(s)${
      done
        ? ' — crawl done'
        : stoppedForBudget
          ? ` — budget stop, resume jobIndex=${cursor.jobIndex} before=${before} (${cursor.sport}/${cursor.season}/${cursor.entityType})`
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

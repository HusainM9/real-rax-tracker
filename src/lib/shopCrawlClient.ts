import { SHOP_EARNINGS_PAGE_SIZE } from '../../lib/realShopEarningsCrawl'

/** Default pages per Admin chunk request (1 shop page + ≤20 earnings). */
export const DEFAULT_SHOP_CRAWL_UI_MAX_PAGES = 1

/** Hard cap for the Admin max-pages input (keeps chunk HTTP under typical platform limits). */
export const SHOP_CRAWL_UI_MAX_PAGES_CAP = 5

/** Minimum client wait before treating a silent chunk as failed. */
export const DEFAULT_SHOP_CRAWL_CHUNK_TIMEOUT_MS = 55_000

/** Cap so the browser does not wait past typical Vercel function limits. */
export const SHOP_CRAWL_CHUNK_TIMEOUT_CEILING_MS = 280_000

export const SHOP_CRAWL_WAIT_STATUS_INTERVAL_MS = 4_000
export const SHOP_CRAWL_WAIT_LOG_INTERVAL_MS = 10_000

/** Rough Real calls per shop page: 1 earningstotal + up to PAGE_SIZE earnings. */
export const SHOP_CRAWL_CALLS_PER_PAGE = 1 + SHOP_EARNINGS_PAGE_SIZE

/** localStorage key for Admin shop-crawl resume cursor (includes full config). */
export const SHOP_CRAWL_RESUME_STORAGE_KEY = 'real-rax-tracker:admin-shop-crawl-resume:v1'

export type ShopCrawlEntityType = 'player' | 'team'

/** Config that must match for a saved cursor to be resumable. */
export type ShopCrawlResumeConfig = {
  seasons: number[]
  sports: string[]
  entityTypes: ShopCrawlEntityType[]
  includeUfc: boolean
}

/** Persisted resume point after a completed chunk or Stop. */
export type ShopCrawlResumeCursor = ShopCrawlResumeConfig & {
  jobIndex: number
  before: number
  sport?: string
  season?: number
  entityType?: ShopCrawlEntityType
  jobsTotal?: number
  savedAt?: string
}

export function normalizeShopCrawlSeasons(seasons: number[]): number[] {
  return [...new Set(seasons.filter((season) => Number.isInteger(season) && season > 0))].sort(
    (a, b) => a - b,
  )
}

export function normalizeShopCrawlSports(sports: string[]): string[] {
  return [
    ...new Set(
      sports
        .map((sport) => String(sport).trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort()
}

export function normalizeShopCrawlEntityTypes(
  entityTypes: ShopCrawlEntityType[],
): ShopCrawlEntityType[] {
  const allowed = new Set<ShopCrawlEntityType>(['player', 'team'])
  return [
    ...new Set(
      entityTypes.filter((type): type is ShopCrawlEntityType => allowed.has(type)),
    ),
  ].sort()
}

export function normalizeShopCrawlResumeConfig(
  config: ShopCrawlResumeConfig,
): ShopCrawlResumeConfig {
  return {
    seasons: normalizeShopCrawlSeasons(config.seasons),
    sports: normalizeShopCrawlSports(config.sports),
    entityTypes: normalizeShopCrawlEntityTypes(config.entityTypes),
    includeUfc: Boolean(config.includeUfc),
  }
}

export function shopCrawlConfigsMatch(
  a: ShopCrawlResumeConfig,
  b: ShopCrawlResumeConfig,
): boolean {
  const left = normalizeShopCrawlResumeConfig(a)
  const right = normalizeShopCrawlResumeConfig(b)
  return (
    left.includeUfc === right.includeUfc &&
    left.seasons.join(',') === right.seasons.join(',') &&
    left.sports.join(',') === right.sports.join(',') &&
    left.entityTypes.join(',') === right.entityTypes.join(',')
  )
}

export function formatShopCrawlResumeCursor(cursor: {
  jobIndex: number
  before: number
  sport?: string
  season?: number
  entityType?: string
  jobsTotal?: number
}): string {
  const jobPart =
    cursor.sport && cursor.season && cursor.entityType
      ? `${cursor.sport}/${cursor.season}/${cursor.entityType}`
      : null
  const jobsTotalPart =
    typeof cursor.jobsTotal === 'number' && cursor.jobsTotal > 0
      ? ` of ${cursor.jobsTotal}`
      : ''
  const where = jobPart ? ` (${jobPart})` : ''
  return `jobIndex=${cursor.jobIndex}${jobsTotalPart}${where}, before=${cursor.before}`
}

/** Advance shop pagination offset by N pages (PAGE_SIZE each). */
export function advanceShopCrawlBeforeByPages(before: number, pages: number): number {
  const safeBefore = Math.max(0, Math.floor(before) || 0)
  const safePages = Math.max(0, Math.floor(pages) || 0)
  return safeBefore + safePages * SHOP_EARNINGS_PAGE_SIZE
}

/**
 * Skip N UI chunks without fetching: each chunk covers maxPages shop pages,
 * so before advances by N × maxPages × PAGE_SIZE.
 */
export function advanceShopCrawlBeforeByChunks(
  before: number,
  chunks: number,
  maxPages: number = DEFAULT_SHOP_CRAWL_UI_MAX_PAGES,
): number {
  const pages = Math.max(1, Math.floor(maxPages) || 1)
  return advanceShopCrawlBeforeByPages(before, Math.max(0, Math.floor(chunks) || 0) * pages)
}

function isShopCrawlEntityType(value: unknown): value is ShopCrawlEntityType {
  return value === 'player' || value === 'team'
}

export function parseShopCrawlResumeCursor(raw: unknown): ShopCrawlResumeCursor | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const seasons = Array.isArray(value.seasons)
    ? value.seasons.map((item) => Number(item)).filter((season) => Number.isInteger(season) && season > 0)
    : []
  const sports = Array.isArray(value.sports)
    ? value.sports.map((item) => String(item)).filter(Boolean)
    : []
  const entityTypes = Array.isArray(value.entityTypes)
    ? value.entityTypes.filter(isShopCrawlEntityType)
    : []
  const jobIndex = Number(value.jobIndex)
  const before = Number(value.before)
  if (!Number.isInteger(jobIndex) || jobIndex < 0) return null
  if (!Number.isInteger(before) || before < 0) return null
  if (seasons.length === 0) return null
  if (sports.length === 0 && value.includeUfc !== true) return null

  const cursor: ShopCrawlResumeCursor = {
    ...normalizeShopCrawlResumeConfig({
      seasons,
      sports,
      entityTypes,
      includeUfc: value.includeUfc === true,
    }),
    jobIndex,
    before,
  }
  if (typeof value.sport === 'string' && value.sport.trim()) cursor.sport = value.sport.trim()
  if (Number.isInteger(Number(value.season)) && Number(value.season) > 0) {
    cursor.season = Number(value.season)
  }
  if (isShopCrawlEntityType(value.entityType)) cursor.entityType = value.entityType
  if (Number.isInteger(Number(value.jobsTotal)) && Number(value.jobsTotal) > 0) {
    cursor.jobsTotal = Number(value.jobsTotal)
  }
  if (typeof value.savedAt === 'string' && value.savedAt.trim()) {
    cursor.savedAt = value.savedAt.trim()
  }
  return cursor
}

export function loadShopCrawlResumeCursor(
  storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage !== 'undefined'
    ? localStorage
    : null,
): ShopCrawlResumeCursor | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(SHOP_CRAWL_RESUME_STORAGE_KEY)
    if (!raw) return null
    return parseShopCrawlResumeCursor(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

export function saveShopCrawlResumeCursor(
  cursor: ShopCrawlResumeCursor,
  storage: Pick<Storage, 'setItem'> | null | undefined = typeof localStorage !== 'undefined'
    ? localStorage
    : null,
): ShopCrawlResumeCursor {
  const normalized: ShopCrawlResumeCursor = {
    ...normalizeShopCrawlResumeConfig(cursor),
    jobIndex: Math.max(0, Math.floor(cursor.jobIndex) || 0),
    before: Math.max(0, Math.floor(cursor.before) || 0),
    savedAt: cursor.savedAt ?? new Date().toISOString(),
  }
  if (cursor.sport) normalized.sport = cursor.sport
  if (typeof cursor.season === 'number') normalized.season = cursor.season
  if (cursor.entityType) normalized.entityType = cursor.entityType
  if (typeof cursor.jobsTotal === 'number') normalized.jobsTotal = cursor.jobsTotal
  if (!storage) return normalized
  try {
    storage.setItem(SHOP_CRAWL_RESUME_STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    // Ignore quota / private-mode failures; in-memory state still works for the session.
  }
  return normalized
}

export function clearShopCrawlResumeCursor(
  storage: Pick<Storage, 'removeItem'> | null | undefined = typeof localStorage !== 'undefined'
    ? localStorage
    : null,
): void {
  if (!storage) return
  try {
    storage.removeItem(SHOP_CRAWL_RESUME_STORAGE_KEY)
  } catch {
    // ignore
  }
}
/**
 * Client abort budget for one chunk POST. Scales with pages × delay so intentional
 * multi-page chunks are not always killed at 55s, but never waits forever.
 */
export function estimateShopCrawlChunkTimeoutMs(
  maxPages: number,
  delayMs: number,
  options?: { floorMs?: number; ceilingMs?: number },
): number {
  const floorMs = options?.floorMs ?? DEFAULT_SHOP_CRAWL_CHUNK_TIMEOUT_MS
  const ceilingMs = options?.ceilingMs ?? SHOP_CRAWL_CHUNK_TIMEOUT_CEILING_MS
  const pages = Math.max(1, Math.floor(maxPages) || 1)
  const delay = Math.max(0, Math.floor(delayMs) || 0)
  const estimated = pages * SHOP_CRAWL_CALLS_PER_PAGE * delay + 20_000
  return Math.min(ceilingMs, Math.max(floorMs, estimated))
}

export function shopCrawlWaitingMessage(chunk: number, elapsedMs: number): string {
  const elapsedSec = Math.max(0, Math.round(elapsedMs / 1000))
  return `Still on chunk ${chunk}… (${elapsedSec}s elapsed; shop + earnings can take ~30–60s per page)`
}

export function shopCrawlChunkTimeoutMessage(
  chunk: number,
  timeoutMs: number,
  jobIndex: number,
  before: number,
): string {
  const timeoutSec = Math.round(timeoutMs / 1000)
  return (
    `Chunk ${chunk} timed out after ${timeoutSec}s with no response. ` +
    `The platform may have killed a long request, or Real is slow. ` +
    `Lower Delay ms (try 250–400), keep max pages at 1, then retry. Resume jobIndex=${jobIndex}, before=${before}.`
  )
}

/** Turn Vercel platform / non-JSON bodies into an actionable Admin error. */
export function formatShopCrawlHttpFailure(status: number, bodySnippet: string): string {
  const snippet = bodySnippet.trim().replace(/\s+/g, ' ').slice(0, 200)
  if (/FUNCTION_INVOCATION_FAILED|FUNCTION_INVOCATION_TIMEOUT/i.test(snippet)) {
    return (
      `Shop earnings crawl failed (${status}): Vercel killed the function before it returned JSON. ` +
      `Usually a timeout — lower Delay ms (try 250–400), keep max pages/chunk at 1, and confirm REAL_IMPORT_ENABLED + REAL_AUTH_* + SUPABASE_* are set on Vercel (then redeploy). ` +
      `(${snippet.slice(0, 80)}…)`
    )
  }
  if (!snippet) {
    return `Shop earnings crawl failed (${status}).`
  }
  return `Shop earnings crawl failed (${status}): ${snippet}`
}

export type LinkedAbort = {
  signal: AbortSignal
  timedOut: () => boolean
  dispose: () => void
}

/** Abort when the parent signal aborts or the timeout elapses. */
export function linkAbortTimeout(timeoutMs: number, parent: AbortSignal): LinkedAbort {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, Math.max(1, Math.floor(timeoutMs)))
  const onParentAbort = () => {
    controller.abort()
  }
  if (parent.aborted) {
    controller.abort()
  } else {
    parent.addEventListener('abort', onParentAbort, { once: true })
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer)
      parent.removeEventListener('abort', onParentAbort)
    },
  }
}

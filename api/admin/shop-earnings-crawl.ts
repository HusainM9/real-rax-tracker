import {
  RealApiError,
  getPassEarnings,
  getShopEarningsTotal,
  realImportConfigStatus,
  resolveRealApiConfig,
  type RealApiContext,
} from '../../lib/realApi'
import {
  MAX_SHOP_CRAWL_MAX_PAGES,
  buildShopCrawlJobs,
  crawlShopEarningsTotalChunk,
  resolveShopCrawlDelayMs,
  resolveShopCrawlEarningsConcurrency,
  resolveShopCrawlMaxPages,
  type ShopCrawlChunkInput,
  type ShopCrawlEntityType,
} from '../../lib/realShopEarningsCrawl'
import { meowbotCatalogConfigured } from '../../lib/meowbotCatalogStore'
import { requireAdminSession } from './_helpers'

/** Node runtime + long maxDuration: one chunk can still take minutes if maxPages is raised. */
export const config = {
  runtime: 'nodejs',
  maxDuration: 300,
}

type RequestBody = {
  sports?: unknown
  seasons?: unknown
  entityTypes?: unknown
  includeUfc?: unknown
  before?: unknown
  jobIndex?: unknown
  maxPages?: unknown
  maxBefore?: unknown
  delayMs?: unknown
  earningsConcurrency?: unknown
}

function parseSeasons(input: unknown): number[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\s,]+/)
      : []
  return [
    ...new Set(
      raw
        .map((item) => Number(item))
        .filter((season) => Number.isInteger(season) && season > 0),
    ),
  ]
}

function parseSports(input: unknown): string[] | undefined {
  if (input == null) return undefined
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\s,]+/)
      : []
  const sports = [
    ...new Set(raw.map((item) => String(item).trim()).filter(Boolean)),
  ]
  return sports.length > 0 ? sports : undefined
}

function parseEntityTypes(input: unknown): ShopCrawlEntityType[] | undefined {
  if (input == null) return undefined
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\s,]+/)
      : []
  const types = [
    ...new Set(
      raw
        .map((item) => String(item).trim().toLowerCase())
        .filter((item): item is ShopCrawlEntityType => item === 'player' || item === 'team'),
    ),
  ]
  return types.length > 0 ? types : undefined
}

function numberOrUndefined(input: unknown): number | undefined {
  if (input == null || input === '') return undefined
  const value = Number(input)
  return Number.isFinite(value) ? value : undefined
}

function errorResponse(error: unknown): Response {
  if (error instanceof RealApiError) {
    const message =
      error.kind === 'auth'
        ? 'Real rejected the bot session (401). Refresh REAL_AUTH_INFO / REAL_SESSION_TOKEN before crawling again.'
        : error.message
    const status = error.kind === 'rate_limited' ? 429 : 502
    const code = error.kind === 'auth' ? 'real_session_expired' : `real_${error.kind}`
    return Response.json(
      {
        error: message,
        code,
        log: [{ type: 'client_error', message }],
      },
      { status },
    )
  }
  const message = error instanceof Error ? error.message : 'Shop earnings crawl failed.'
  return Response.json(
    { error: message, log: [{ type: 'client_error', message }] },
    { status: 500 },
  )
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const denied = await requireAdminSession(request)
  if (denied) return denied

  if (!meowbotCatalogConfigured()) {
    return Response.json(
      {
        error: 'Supabase catalog is not configured.',
        log: [{ type: 'client_error', message: 'Supabase catalog is not configured.' }],
      },
      { status: 503 },
    )
  }

  const realConfig = resolveRealApiConfig()
  if (!realConfig) {
    console.warn('shop-earnings-crawl: Real import not configured', realImportConfigStatus())
    return Response.json(
      {
        error: 'Real import is not configured in this environment.',
        log: [
          {
            type: 'client_error',
            message: 'Real import is not configured in this environment.',
          },
        ],
      },
      { status: 503 },
    )
  }

  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const seasons = parseSeasons(body.seasons)
  if (seasons.length === 0) {
    return Response.json(
      {
        error: 'Enter at least one season year.',
        log: [{ type: 'client_error', message: 'Enter at least one season year.' }],
      },
      { status: 400 },
    )
  }

  const defaultMaxPages = resolveShopCrawlMaxPages()
  const defaultDelayMs = resolveShopCrawlDelayMs()
  const defaultEarningsConcurrency = resolveShopCrawlEarningsConcurrency()
  const maxPages = Math.min(
    MAX_SHOP_CRAWL_MAX_PAGES,
    Math.max(1, Math.floor(numberOrUndefined(body.maxPages) ?? defaultMaxPages)),
  )
  const delayMs = Math.max(0, Math.floor(numberOrUndefined(body.delayMs) ?? defaultDelayMs))
  const earningsConcurrency = Math.min(
    4,
    Math.max(
      1,
      Math.floor(numberOrUndefined(body.earningsConcurrency) ?? defaultEarningsConcurrency),
    ),
  )

  const input: ShopCrawlChunkInput = {
    sports: parseSports(body.sports),
    seasons,
    entityTypes: parseEntityTypes(body.entityTypes),
    includeUfc: body.includeUfc === true || body.includeUfc === 'true' || body.includeUfc === 1,
    before: numberOrUndefined(body.before) ?? 0,
    jobIndex: numberOrUndefined(body.jobIndex) ?? 0,
    maxPages,
    maxBefore: numberOrUndefined(body.maxBefore),
    delayMs,
    earningsConcurrency,
  }

  // Reject empty job lists before hitting Real (clear error for Admin activity log).
  const plannedJobs = buildShopCrawlJobs(input)
  if (plannedJobs.length === 0) {
    const message =
      'No crawl jobs to run. Select at least one sport (or UFC), and for live sports choose players and/or teams. UFC uses the team shop path (season 2023 All-time) automatically.'
    return Response.json(
      {
        error: message,
        log: [{ type: 'client_error', message }],
      },
      { status: 400 },
    )
  }

  const context: RealApiContext = { config: realConfig, signal: request.signal }

  try {
    const result = await crawlShopEarningsTotalChunk(input, {
      fetchPage: (query) => getShopEarningsTotal(query, context),
      fetchEarnings: (query) => getPassEarnings(query, context),
      signal: request.signal,
    })
    return Response.json({
      ok: true,
      ...result,
      // Structured activity lines for the Admin crawl log panel (client appends per chunk).
      log: result.log ?? [],
      maxPages,
      delayMs,
      earningsConcurrency,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

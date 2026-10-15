import { methodNotAllowed } from '../../lib/httpResponses'

import {
  RealApiError,
  getPassEarnings,
  getShopEarningsTotal,
  realImportConfigStatus,
  resolveRealApiConfig,
  type RealApiContext,
} from '../../lib/realApi'
import {
  MAX_AVATAR_SHOP_CRAWL_MAX_PAGES,
  MAX_SHOP_CRAWL_MAX_PAGES,
  buildShopCrawlJobs,
  crawlShopEarningsTotalChunk,
  resolveShopCrawlBudgetMs,
  resolveShopCrawlDelayMs,
  resolveShopCrawlEarningsConcurrency,
  resolveShopCrawlMaxPages,
  type ShopCrawlChunkInput,
  type ShopCrawlEntityType,
} from '../../lib/realShopEarningsCrawl'
import { meowbotCatalogConfigured } from '../../lib/meowbotCatalogStore'
import { requireAdminSession } from './_helpers'

/**
 * Edge (not Node): Hobby Edge allows ~30s vs Hobby Node ~10s. hashids / fetch already work on
 * Edge via other Real import routes. Soft budget in the crawl returns JSON before the platform
 * hard-kills the invocation (FUNCTION_INVOCATION_FAILED).
 */
export const config = {
  runtime: 'edge',
  maxDuration: 60,
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
  budgetMs?: unknown
  avatarsOnly?: unknown
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
  const lower = message.toLowerCase()
  const missingSupabase =
    lower.includes('supabase') && (lower.includes('not configured') || lower.includes('is not configured'))
  const status = missingSupabase ? 503 : 502
  const code = missingSupabase ? 'supabase_not_configured' : 'shop_crawl_failed'
  return Response.json(
    { error: message, code, log: [{ type: 'client_error', message }] },
    { status },
  )
}

async function handleShopEarningsCrawl(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  const denied = await requireAdminSession(request)
  if (denied) return denied

  if (!meowbotCatalogConfigured()) {
    return Response.json(
      {
        error:
          'Supabase catalog is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on Vercel, then redeploy.',
        code: 'supabase_not_configured',
        log: [
          {
            type: 'client_error',
            message:
              'Supabase catalog is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on Vercel, then redeploy.',
          },
        ],
      },
      { status: 503 },
    )
  }

  const realConfig = resolveRealApiConfig()
  if (!realConfig) {
    const status = realImportConfigStatus()
    console.warn('shop-earnings-crawl: Real import not configured', status)
    const message =
      'Real import is not configured in this environment. On Vercel set REAL_IMPORT_ENABLED=true plus REAL_AUTH_INFO, REAL_SESSION_TOKEN, and REAL_DEVICE_UUID, then redeploy.'
    return Response.json(
      {
        error: message,
        code: 'real_import_not_configured',
        configStatus: status,
        log: [{ type: 'client_error', message }],
      },
      { status: 503 },
    )
  }

  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return Response.json({ error: 'Invalid request body', code: 'invalid_body' }, { status: 400 })
  }

  const seasons = parseSeasons(body.seasons)
  if (seasons.length === 0) {
    return Response.json(
      {
        error: 'Enter at least one season year.',
        code: 'missing_seasons',
        log: [{ type: 'client_error', message: 'Enter at least one season year.' }],
      },
      { status: 400 },
    )
  }

  const defaultMaxPages = resolveShopCrawlMaxPages()
  const defaultDelayMs = resolveShopCrawlDelayMs()
  const defaultEarningsConcurrency = resolveShopCrawlEarningsConcurrency()
  const defaultBudgetMs = resolveShopCrawlBudgetMs()
  const avatarsOnly =
    body.avatarsOnly === true || body.avatarsOnly === 'true' || body.avatarsOnly === 1
  const pageCap = avatarsOnly ? MAX_AVATAR_SHOP_CRAWL_MAX_PAGES : MAX_SHOP_CRAWL_MAX_PAGES
  const maxPages = Math.min(
    pageCap,
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
  const budgetMs = Math.max(
    5_000,
    Math.floor(numberOrUndefined(body.budgetMs) ?? defaultBudgetMs),
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
    budgetMs,
    avatarsOnly,
  }

  // Reject empty job lists before hitting Real (clear error for Admin activity log).
  const plannedJobs = buildShopCrawlJobs(input)
  if (plannedJobs.length === 0) {
    const message =
      'No crawl jobs to run. Select at least one sport (or UFC), and for live sports choose players and/or teams. UFC uses the team shop path (season 2023 All-time) automatically.'
    return Response.json(
      {
        error: message,
        code: 'no_crawl_jobs',
        log: [{ type: 'client_error', message }],
      },
      { status: 400 },
    )
  }

  const context: RealApiContext = { config: realConfig, signal: request.signal }

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
    budgetMs,
  })
}

export default async function handler(request: Request): Promise<Response> {
  try {
    return await handleShopEarningsCrawl(request)
  } catch (error) {
    console.error('shop-earnings-crawl failed', error)
    return errorResponse(error)
  }
}

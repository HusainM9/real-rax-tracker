import { gzipJsonToBase64 } from '../../lib/cloudSyncCompression'
import {
  RealApiError,
  getPassEarnings,
  realImportConfigStatus,
  resolveRealApiConfig,
  type RealApiContext,
} from '../../lib/realApi'
import {
  backfillRealPassEarnings,
  catalogEarningsBackfillDeps,
  REAL_EARNINGS_PASSES_MAX_REQUEST,
  type EarningsBackfillPass,
} from '../../lib/realEarningsBackfill'
import { requireAppSession } from '../admin/_helpers'

export const config = {
  runtime: 'edge',
}

type RealEarningsRequest = {
  passes?: unknown
}

function parsePass(raw: unknown): EarningsBackfillPass | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  const externalKey = typeof value.externalKey === 'string' ? value.externalKey.trim() : ''
  const entityId = Number(value.entityId)
  const seasonYear = Number(value.seasonYear)
  const sportRaw = typeof value.sportRaw === 'string' ? value.sportRaw.trim().toLowerCase() : ''

  if (!externalKey || !sportRaw) return null
  if (!Number.isFinite(entityId) || entityId <= 0) return null
  if (!Number.isInteger(seasonYear) || seasonYear <= 0) return null

  return {
    externalKey,
    entityId,
    passKind: value.passKind === 'team' ? 'team' : 'player',
    sportRaw,
    seasonYear,
    seasonLabel: typeof value.seasonLabel === 'string' ? value.seasonLabel : '',
    name: typeof value.name === 'string' ? value.name : `Entity ${entityId}`,
    rarityLabel: typeof value.rarityLabel === 'string' ? value.rarityLabel : undefined,
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof RealApiError) {
    switch (error.kind) {
      case 'auth':
        return Response.json(
          {
            error:
              'Real rejected the import session. The bot session needs refreshing before the daily RAX backfill works again.',
            code: 'real_session_expired',
          },
          { status: 502 },
        )
      case 'rate_limited':
        return Response.json({ error: error.message, code: 'real_rate_limited' }, { status: 429 })
      default:
        return Response.json({ error: error.message, code: `real_${error.kind}` }, { status: 502 })
    }
  }

  return Response.json(
    { error: error instanceof Error ? error.message : 'Daily RAX backfill failed.' },
    { status: 500 },
  )
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const denied = await requireAppSession(request)
  if (denied) return denied

  const realConfig = resolveRealApiConfig()
  if (!realConfig) {
    // Presence-only diagnostics; credential values must never be logged.
    console.warn('real-earnings: import not configured', realImportConfigStatus())
    return Response.json(
      { error: 'Real daily RAX backfill is not configured in this environment.' },
      { status: 503 },
    )
  }

  let body: RealEarningsRequest
  try {
    body = (await request.json()) as RealEarningsRequest
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const rawPasses = Array.isArray(body.passes) ? body.passes : []
  if (rawPasses.length === 0) {
    return Response.json({ error: 'passes array is required' }, { status: 400 })
  }
  if (rawPasses.length > REAL_EARNINGS_PASSES_MAX_REQUEST) {
    return Response.json(
      {
        error: `Too many passes in one request (max ${REAL_EARNINGS_PASSES_MAX_REQUEST}). Hard-refresh the page (Ctrl+Shift+R) if this persists after updating.`,
      },
      { status: 400 },
    )
  }

  const passes = rawPasses
    .map(parsePass)
    .filter((pass): pass is EarningsBackfillPass => pass !== null)
  if (passes.length === 0) {
    return Response.json({ error: 'No valid passes in request' }, { status: 400 })
  }

  const context: RealApiContext = { config: realConfig, signal: request.signal }

  try {
    const result = await backfillRealPassEarnings(
      passes,
      catalogEarningsBackfillDeps((query) => getPassEarnings(query, context), {
        concurrency: realConfig.concurrency,
      }),
    )

    return Response.json({
      ok: true,
      source: 'real_api',
      stats: result.stats,
      failures: result.failures,
      counts: {
        passes: result.passes.length,
        rows: result.passes.reduce((sum, pass) => sum + pass.rows.length, 0),
      },
      passesEncoding: 'gzip-base64',
      passesPayload: await gzipJsonToBase64(result.passes),
    })
  } catch (error) {
    return errorResponse(error)
  }
}

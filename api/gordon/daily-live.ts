import { RealApiError, realImportConfigStatus, resolveRealApiConfig } from '../../lib/realApi'
import { collectLiveDailyRax, type LiveDailyPassInput } from '../../lib/realDailyLiveRax'
import { requireGordonSession } from './_helpers'

export const config = {
  runtime: 'edge',
}

type DailyLiveRequest = {
  day?: unknown
  passes?: unknown
}

function errorResponse(error: unknown): Response {
  if (error instanceof RealApiError) {
    switch (error.kind) {
      case 'auth':
        return Response.json(
          {
            error:
              'Real rejected the import session. The bot session needs refreshing before live daily RAX works.',
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
    { error: error instanceof Error ? error.message : 'Live daily RAX failed.' },
    { status: 500 },
  )
}

function parsePasses(raw: unknown): LiveDailyPassInput[] {
  if (!Array.isArray(raw)) return []
  const passes: LiveDailyPassInput[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const entityId = Number(record.entityId)
    const seasonYear = Number(record.seasonYear)
    const sportRaw = typeof record.sportRaw === 'string' ? record.sportRaw : ''
    const externalKey = typeof record.externalKey === 'string' ? record.externalKey.trim() : ''
    if (!Number.isInteger(entityId) || entityId <= 0) continue
    if (!Number.isInteger(seasonYear) || seasonYear <= 0) continue
    if (!sportRaw || !externalKey) continue
    const teamId = Number(record.teamId)
    passes.push({
      externalKey,
      entityId,
      sportRaw,
      seasonYear,
      passKind: record.passKind === 'team' ? 'team' : 'player',
      teamId: Number.isInteger(teamId) && teamId > 0 ? teamId : undefined,
    })
  }
  return passes
}

export default async function handler(request: Request): Promise<Response> {
  const session = await requireGordonSession(request)
  if (session instanceof Response) return session

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const realConfig = resolveRealApiConfig()
  if (!realConfig) {
    console.warn('gordon/daily-live: Real import not configured', realImportConfigStatus())
    return Response.json(
      { error: 'Real import is not configured in this environment.' },
      { status: 503 },
    )
  }

  let body: DailyLiveRequest
  try {
    body = (await request.json()) as DailyLiveRequest
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const day = typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : ''
  if (!day) {
    return Response.json({ error: 'day (YYYY-MM-DD) is required.' }, { status: 400 })
  }

  const passes = parsePasses(body.passes)
  if (passes.length === 0) {
    return Response.json({ ok: true, day, rows: [] })
  }

  try {
    const rows = await collectLiveDailyRax(passes, day, { config: realConfig, signal: request.signal })
    return Response.json({ ok: true, day, rows })
  } catch (error) {
    return errorResponse(error)
  }
}

import { gzipJsonToBase64 } from '../../lib/cloudSyncCompression'
import {
  RealApiError,
  getUserByUsername,
  listPasses,
  normalizeRealUsernameInput,
  realImportConfigStatus,
  resolveRealApiConfig,
  type RealApiContext,
} from '../../lib/realApi'
import { buildRealPassPayload, scanRealUserPasses } from '../../lib/realPassScan'
import { requireAppSession } from '../admin/_helpers'

type RealPassesRequest = {
  username?: unknown
}

export const config = {
  runtime: 'edge',
}

function errorResponse(error: unknown): Response {
  if (error instanceof RealApiError) {
    switch (error.kind) {
      case 'auth':
        return Response.json(
          {
            error:
              'Real rejected the import session. The bot session needs refreshing before username import works again.',
            code: 'real_session_expired',
          },
          { status: 502 },
        )
      case 'not_found':
        return Response.json({ error: error.message, code: 'real_not_found' }, { status: 404 })
      case 'rate_limited':
        return Response.json({ error: error.message, code: 'real_rate_limited' }, { status: 429 })
      default:
        return Response.json({ error: error.message, code: `real_${error.kind}` }, { status: 502 })
    }
  }

  return Response.json(
    { error: error instanceof Error ? error.message : 'Real pass import failed.' },
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
    console.warn('real-passes: import not configured', realImportConfigStatus())
    return Response.json(
      { error: 'Real pass import is not configured in this environment.' },
      { status: 503 },
    )
  }

  let body: RealPassesRequest
  try {
    body = (await request.json()) as RealPassesRequest
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const username = normalizeRealUsernameInput(
    typeof body.username === 'string' ? body.username : '',
  )
  if (!username) {
    return Response.json({ error: 'Username is required' }, { status: 400 })
  }

  const context: RealApiContext = { config: realConfig, signal: request.signal }

  try {
    const user = await getUserByUsername(username, context)
    const scan = await scanRealUserPasses(user.id, (query) => listPasses(query, context), {
      concurrency: realConfig.concurrency,
    })
    const payload = buildRealPassPayload(scan.passes)

    if (payload.playerPasses.length === 0 && payload.teamPasses.length === 0) {
      return Response.json(
        { error: `No passes found for @${user.userName}.`, code: 'real_no_passes' },
        { status: 404 },
      )
    }

    return Response.json({
      ok: true,
      source: 'real_api',
      username: user.userName,
      userId: user.id,
      strategy: scan.strategy,
      requests: scan.requests,
      // Raw count exposes silent truncation: no pagination cursor has been observed, but the
      // largest verified collection was ~1251 passes.
      rawPassCount: scan.passes.length,
      counts: {
        playerPasses: payload.playerPasses.length,
        teamPasses: payload.teamPasses.length,
        rarityKeys: Object.keys(payload.rarities).length,
      },
      passesEncoding: 'gzip-base64',
      passesPayload: await gzipJsonToBase64(payload),
    })
  } catch (error) {
    return errorResponse(error)
  }
}

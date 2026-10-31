import { withErrorLogging } from '../../lib/withErrorLogging.js'
import { methodNotAllowed } from '../../lib/httpResponses.js'
import { isTerminalRequestFailure, requestFailureResponse } from '../../lib/httpFailurePolicy.js'

import { gzipJsonToBase64 } from '../../lib/cloudSyncCompression.js'
import {
  RealApiError,
  normalizeRealUsernameInput,
  realImportConfigStatus,
  resolveRealApiConfig,
  type RealApiContext,
} from '../../lib/realApi.js'
import { buildRealPassPayload } from '../../lib/realPassScan.js'
import { getRealOwnershipSnapshot } from '../../lib/realOwnershipSnapshot.js'
import { requireAppSession } from '../admin/_helpers.js'

type RealPassesRequest = {
  username?: unknown
  forceRefresh?: unknown
}

export const config = {
  runtime: 'edge',
}

function errorResponse(error: unknown): Response {
  if (isTerminalRequestFailure(error)) return requestFailureResponse(error)
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

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
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
    const { user, passes, fetchedAt, source } = await getRealOwnershipSnapshot(username, context, {
      // A collection replacement is fresh by default; its scan can then accelerate Packs.
      forceRefresh: body.forceRefresh !== false,
    })
    const payload = buildRealPassPayload(passes)

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
      strategy: 'single',
      requests: source === 'real' ? 1 : 0,
      fetchedAt,
      snapshotSource: source,
      // Raw count exposes silent truncation: no pagination cursor has been observed, but the
      // largest verified collection was ~1251 passes.
      rawPassCount: passes.length,
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

export default withErrorLogging('/api/import/real-passes', handler)

import { withErrorLogging } from '../../lib/withErrorLogging.js'
import { methodNotAllowed } from '../../lib/httpResponses.js'
import { isTerminalRequestFailure, requestFailureResponse } from '../../lib/httpFailurePolicy.js'

import {
  RealApiError,
  normalizeRealUsernameInput,
  realImportConfigStatus,
  resolveRealApiConfig,
  type RealApiContext,
  type RealPass,
} from '../../lib/realApi.js'
import {
  displaySportFromRaw,
  usernameImportExternalKey,
} from '../../lib/usernameImportShared.js'
import { requireAppSession } from '../admin/_helpers.js'
import { absolutePlayRating } from '../../lib/playRating.js'
import { getRealOwnershipSnapshot } from '../../lib/realOwnershipSnapshot.js'
import { normalizeRealPass } from '../../lib/realPassScan.js'

type PackRatingsRequest = {
  username?: unknown
  forceRefresh?: unknown
}

export type PackRatingPass = {
  externalKey: string
  name: string
  sport: string
  season: string
  seasonYear: number
  entityId: number
  passKind: 'player' | 'team'
  rarityLabel?: string
  progress: number
  rating: number | null
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
    { error: error instanceof Error ? error.message : 'Pack rating import failed.' },
    { status: 500 },
  )
}

function toPackRatingPass(raw: RealPass): PackRatingPass | null {
  const normalized = normalizeRealPass(raw)
  if (!normalized || normalized.passKind === 'team') return null
  const { entityId, season: seasonYear, sportRaw, rarityLabel } = normalized
  const progressRaw = Number(raw.boostInfo?.progress)
  const progress = Number.isFinite(progressRaw) && progressRaw > 0 ? Math.floor(progressRaw) : 0
  return {
    externalKey: usernameImportExternalKey(entityId, seasonYear, sportRaw),
    name: normalized.playerName || 'Unknown',
    sport: displaySportFromRaw(sportRaw),
    season: normalized.seasonLabel || String(seasonYear),
    seasonYear,
    entityId,
    passKind: normalized.passKind,
    rarityLabel,
    progress,
    rating: absolutePlayRating(rarityLabel, progress),
  }
}

/**
 * Prefer the highest-rated copy when an account owns duplicates of the same pass.
 */
function collapsePasses(passes: PackRatingPass[]): PackRatingPass[] {
  const byKey = new Map<string, PackRatingPass>()
  for (const pass of passes) {
    const existing = byKey.get(pass.externalKey)
    if (!existing) {
      byKey.set(pass.externalKey, pass)
      continue
    }
    const existingRating = existing.rating ?? -1
    const nextRating = pass.rating ?? -1
    if (nextRating > existingRating) byKey.set(pass.externalKey, pass)
  }
  return [...byKey.values()]
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  const denied = await requireAppSession(request)
  if (denied) return denied

  const realConfig = resolveRealApiConfig()
  if (!realConfig) {
    console.warn('pack-ratings: import not configured', realImportConfigStatus())
    return Response.json(
      { error: 'Real pass import is not configured in this environment.' },
      { status: 503 },
    )
  }

  let body: PackRatingsRequest
  try {
    body = (await request.json()) as PackRatingsRequest
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
    const { user, passes: rawPasses, fetchedAt, startedAt, source } = await getRealOwnershipSnapshot(username, context, {
      forceRefresh: body.forceRefresh === true,
    })
    const passes = collapsePasses(
      rawPasses
        .map(toPackRatingPass)
        .filter((pass): pass is PackRatingPass => pass !== null),
    )

    return Response.json({
      ok: true,
      username: user.userName,
      userId: user.id,
      passCount: passes.length,
      passes,
      fetchedAt,
      startedAt,
      source,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export default withErrorLogging('/api/import/pack-ratings', handler)

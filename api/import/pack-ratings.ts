import {
  RealApiError,
  getUserByUsername,
  listPasses,
  normalizeRealUsernameInput,
  realImportConfigStatus,
  resolveRealApiConfig,
  type RealApiContext,
  type RealPass,
} from '../../lib/realApi'
import {
  displaySportFromRaw,
  usernameImportExternalKey,
} from '../../lib/usernameImportShared'
import { requireAppSession } from '../admin/_helpers'
import { absolutePlayRating } from '../../lib/playRating'

type PackRatingsRequest = {
  username?: unknown
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

function normalizeRarityLabel(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (!trimmed) return ''
  const [head, ...rest] = trimmed.split(' ')
  if (!head) return trimmed
  const tier = head.charAt(0).toUpperCase() + head.slice(1).toLowerCase()
  const known = ['General', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mystic', 'Iconic']
  const matched = known.find((item) => item.toLowerCase() === tier.toLowerCase())
  return matched ? [matched, ...rest].join(' ') : trimmed
}

function toPackRatingPass(raw: RealPass): PackRatingPass | null {
  if (raw.isRefunded === true) return null

  const entityId = Number(raw.entityId)
  const seasonYear = Number(raw.season)
  const sportRaw = String(raw.sport ?? '').trim().toLowerCase()
  if (!Number.isFinite(entityId) || entityId <= 0) return null
  if (!Number.isInteger(seasonYear) || seasonYear <= 0) return null
  if (!sportRaw) return null

  const passKind =
    String(raw.entityType ?? '').trim().toLowerCase() === 'team' ? 'team' : 'player'
  if (passKind === 'team') return null

  const rarityLabel = normalizeRarityLabel(String(raw.boostInfo?.rarityLabel ?? ''))
  const progressRaw = Number(raw.boostInfo?.progress)
  const progress = Number.isFinite(progressRaw) && progressRaw > 0 ? Math.floor(progressRaw) : 0
  const seasonDisplay = String(raw.seasonDisplay ?? '').replace(/\u2013|\u2014/g, '-').trim()
  const sport = displaySportFromRaw(sportRaw)
  const externalKey = usernameImportExternalKey(entityId, seasonYear, sportRaw)

  return {
    externalKey,
    name: String(raw.label ?? '').trim() || 'Unknown',
    sport,
    season: seasonDisplay || String(seasonYear),
    seasonYear,
    entityId,
    passKind,
    rarityLabel: rarityLabel || undefined,
    progress,
    rating: absolutePlayRating(rarityLabel || undefined, progress),
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

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
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
    const user = await getUserByUsername(username, context)
    const rawPasses = await listPasses({ userId: user.id }, context)
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
    })
  } catch (error) {
    return errorResponse(error)
  }
}

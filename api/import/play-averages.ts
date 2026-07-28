import {
  listAllPlayerRecentPlays,
  realImportConfigStatus,
  resolveRealApiConfig,
  type RealApiContext,
} from '../../lib/realApi'
import {
  averagePlayRatingsFromPlays,
  ratingPerPackFromPlayAverage,
} from '../../lib/playAverages'
import { toRealShopSportSlug } from '../../lib/realShopEarningsCrawl'
import {
  parseEntityIdFromExternalKey,
  parseSeasonYearFromExternalKey,
} from '../../lib/catalogPassIdentity'
import { runWithConcurrency } from '../../lib/runWithConcurrency'
import { requireAppSession } from '../admin/_helpers'

type PlayAveragePassInput = {
  externalKey?: unknown
  entityId?: unknown
  sport?: unknown
  seasonYear?: unknown
}

type PlayAveragesRequest = {
  passes?: unknown
}

export type PlayAverageResult = {
  externalKey: string
  entityId: number
  sport: string
  seasonYear: number
  playCount: number
  ratingSum: number
  averagePlayRating: number
  averageRatingPerPack: number
  /** Rounded divisor suitable for packs estimates. */
  ratingPerPack: number
}

export const config = {
  runtime: 'edge',
}

/** Slightly higher than default Real import concurrency — play list is one call per player usually. */
const PLAY_AVERAGE_CONCURRENCY_CAP = 4

function parseSportFromExternalKey(externalKey: string): string {
  const parts = externalKey.split('|')
  return parts[2]?.trim() ?? ''
}

function normalizePassInput(raw: PlayAveragePassInput): {
  externalKey: string
  entityId: number
  sportSlug: string
  seasonYear: number
} | null {
  const externalKey =
    typeof raw.externalKey === 'string' ? raw.externalKey.trim() : ''
  const entityIdRaw =
    raw.entityId !== undefined && raw.entityId !== null
      ? Number(raw.entityId)
      : parseEntityIdFromExternalKey(externalKey || undefined)
  const seasonYearRaw =
    raw.seasonYear !== undefined && raw.seasonYear !== null
      ? Number(raw.seasonYear)
      : parseSeasonYearFromExternalKey(externalKey || undefined)
  const sportDisplay =
    typeof raw.sport === 'string' && raw.sport.trim()
      ? raw.sport.trim()
      : parseSportFromExternalKey(externalKey)
  const sportSlug = toRealShopSportSlug(sportDisplay)

  if (!externalKey) return null
  if (!Number.isFinite(entityIdRaw) || !entityIdRaw || entityIdRaw <= 0) return null
  if (!Number.isInteger(seasonYearRaw) || !seasonYearRaw || seasonYearRaw <= 0) return null
  if (!sportSlug) return null

  return {
    externalKey,
    entityId: Math.floor(entityIdRaw),
    sportSlug,
    seasonYear: Math.floor(seasonYearRaw),
  }
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const denied = await requireAppSession(request)
  if (denied) return denied

  const realConfig = resolveRealApiConfig()
  if (!realConfig) {
    console.warn('play-averages: import not configured', realImportConfigStatus())
    return Response.json(
      { error: 'Real pass import is not configured in this environment.' },
      { status: 503 },
    )
  }

  let body: PlayAveragesRequest
  try {
    body = (await request.json()) as PlayAveragesRequest
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const rawPasses = Array.isArray(body.passes) ? body.passes : []
  const passes = rawPasses
    .map((item) => (item && typeof item === 'object' ? normalizePassInput(item as PlayAveragePassInput) : null))
    .filter((pass): pass is NonNullable<typeof pass> => pass !== null)

  if (passes.length === 0) {
    return Response.json({ error: 'At least one pass with externalKey is required.' }, { status: 400 })
  }

  const context: RealApiContext = { config: realConfig, signal: request.signal }
  const results: PlayAverageResult[] = []
  const errors: Array<{ externalKey: string; error: string }> = []
  const concurrency = Math.min(
    PLAY_AVERAGE_CONCURRENCY_CAP,
    Math.max(1, realConfig.concurrency || 2),
  )

  await runWithConcurrency(passes, concurrency, async (pass) => {
    try {
      const plays = await listAllPlayerRecentPlays(
        {
          entityId: pass.entityId,
          sport: pass.sportSlug,
          season: pass.seasonYear,
        },
        context,
        { pageSize: 1000 },
      )
      const average = averagePlayRatingsFromPlays(plays)
      if (!average) {
        errors.push({
          externalKey: pass.externalKey,
          error: 'No rated plays found for this player/season.',
        })
        return
      }
      results.push({
        externalKey: pass.externalKey,
        entityId: pass.entityId,
        sport: pass.sportSlug,
        seasonYear: pass.seasonYear,
        playCount: average.playCount,
        ratingSum: Number(average.ratingSum.toFixed(4)),
        averagePlayRating: Number(average.averagePlayRating.toFixed(4)),
        averageRatingPerPack: Number(average.averageRatingPerPack.toFixed(4)),
        ratingPerPack: ratingPerPackFromPlayAverage(average.averagePlayRating),
      })
    } catch (error) {
      errors.push({
        externalKey: pass.externalKey,
        error: error instanceof Error ? error.message : 'Play average import failed.',
      })
    }
  })

  return Response.json({
    ok: true,
    resultCount: results.length,
    results,
    errors,
  })
}

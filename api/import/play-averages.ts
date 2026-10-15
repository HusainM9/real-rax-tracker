import { methodNotAllowed } from '../../lib/httpResponses'

import {
  listPlayerPlaysForPackAverage,
  realImportConfigStatus,
  resolveRealApiConfig,
  type RealApiContext,
} from '../../lib/realApi'
import {
  averagePlayRatingsFromPlays,
  ratingPerPackFromPlayAverage,
  toRealPlaySportSlug,
  MIN_RATING_PER_PACK,
} from '../../lib/playAverages'
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
  ratingPerPack: number
  /** True when Real returned no plays and we fell back to MIN_RATING_PER_PACK. */
  noPlaysFallback?: boolean
}

/**
 * Edge + one Real fetch per invocation.
 * Avoid heavy catalog/shop-crawl imports (nodejs failed with FUNCTION_INVOCATION_FAILED).
 * One pass + one page avoids FUNCTION_INVOCATION_TIMEOUT.
 */
export const config = {
  runtime: 'edge',
}

/** One Real play sample request per player (top, or recent fallback; Real accepts up to ≥1000). */
const PLAY_SAMPLE_LIMIT = 1000

function parseEntityIdFromExternalKey(externalKey?: string): number | null {
  if (!externalKey) return null
  const entityId = Number(externalKey.split('|')[0])
  return Number.isFinite(entityId) ? entityId : null
}

function parseSeasonYearFromExternalKey(externalKey?: string): number | null {
  if (!externalKey) return null
  const seasonYear = Number(externalKey.split('|')[1])
  return Number.isFinite(seasonYear) ? seasonYear : null
}

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
  const sportSlug = toRealPlaySportSlug(sportDisplay)

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
  try {
    if (request.method !== 'POST') {
      return methodNotAllowed()
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
      .map((item) =>
        item && typeof item === 'object' ? normalizePassInput(item as PlayAveragePassInput) : null,
      )
      .filter((pass): pass is NonNullable<typeof pass> => pass !== null)

    if (passes.length === 0) {
      return Response.json(
        { error: 'At least one pass with externalKey is required.' },
        { status: 400 },
      )
    }

    if (passes.length > 1) {
      return Response.json(
        {
          error: 'Send one pass per play-average request (client should batch sequentially).',
          code: 'too_many_passes',
        },
        { status: 400 },
      )
    }

    const pass = passes[0]!
    const context: RealApiContext = { config: realConfig, signal: request.signal }

    try {
      // Prefer `/plays/top?viewFrame=season` (MLB pitchers + season samples). Fall back to
      // `/plays/recent` when top is empty — some NFL/NHL seasons have recent data but no top sample.
      const { plays } = await listPlayerPlaysForPackAverage(
        {
          entityId: pass.entityId,
          sport: pass.sportSlug,
          season: pass.seasonYear,
          limit: PLAY_SAMPLE_LIMIT,
        },
        context,
      )
      const average = averagePlayRatingsFromPlays(plays)
      if (!average) {
        // Empty season sample — use the pack minimum instead of failing the import.
        return Response.json({
          ok: true,
          resultCount: 1,
          results: [
            {
              externalKey: pass.externalKey,
              entityId: pass.entityId,
              sport: pass.sportSlug,
              seasonYear: pass.seasonYear,
              playCount: 0,
              ratingSum: 0,
              averagePlayRating: 0,
              averageRatingPerPack: MIN_RATING_PER_PACK,
              ratingPerPack: MIN_RATING_PER_PACK,
              noPlaysFallback: true,
            },
          ],
          errors: [],
        })
      }

      return Response.json({
        ok: true,
        resultCount: 1,
        results: [
          {
            externalKey: pass.externalKey,
            entityId: pass.entityId,
            sport: pass.sportSlug,
            seasonYear: pass.seasonYear,
            playCount: average.playCount,
            ratingSum: Number(average.ratingSum.toFixed(4)),
            averagePlayRating: Number(average.averagePlayRating.toFixed(4)),
            averageRatingPerPack: Number(average.averageRatingPerPack.toFixed(4)),
            ratingPerPack: ratingPerPackFromPlayAverage(average.averagePlayRating),
            noPlaysFallback: false,
          },
        ],
        errors: [],
      })
    } catch (error) {
      return Response.json({
        ok: true,
        resultCount: 0,
        results: [],
        errors: [
          {
            externalKey: pass.externalKey,
            error: error instanceof Error ? error.message : 'Play average import failed.',
          },
        ],
      })
    }
  } catch (error) {
    console.error('play-averages: unhandled', error)
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Play average import failed.',
        code: 'play_averages_failed',
      },
      { status: 500 },
    )
  }
}

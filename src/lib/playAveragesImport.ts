export type PlayAveragePassInput = {
  externalKey: string
  entityId?: number
  sport?: string
  seasonYear?: number
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
}

export type PlayAveragesImportResult = {
  results: PlayAverageResult[]
  errors: Array<{ externalKey: string; error: string }>
}

export const PLAY_AVERAGES_ENDPOINT = '/api/import/play-averages'

export { PLAYS_PER_PACK, MIN_RATING_PER_PACK } from '../../lib/playAverages'

type PlayAveragesResponse = {
  ok?: boolean
  error?: string
  results?: PlayAverageResult[]
  errors?: Array<{ externalKey: string; error: string }>
}

/**
 * Fetches Real recent plays for each pass and returns average rating
 * (per play and per pack = ×3 plays).
 */
export async function fetchPlayAverages(
  passes: PlayAveragePassInput[],
  signal?: AbortSignal,
): Promise<PlayAveragesImportResult> {
  if (passes.length === 0) {
    throw new Error('Select at least one pass to average.')
  }

  const response = await fetch(PLAY_AVERAGES_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passes }),
    signal,
  })

  const text = await response.text()
  let body: PlayAveragesResponse | null = null
  if (text.trim()) {
    try {
      body = JSON.parse(text) as PlayAveragesResponse
    } catch {
      const snippet = text.trim().replace(/\s+/g, ' ').slice(0, 160)
      throw new Error(
        response.ok
          ? `Play average import returned invalid JSON: ${snippet}`
          : `Play average import failed (${response.status}): ${snippet}`,
      )
    }
  }

  if (!response.ok) {
    throw new Error(body?.error || `Play average import failed (${response.status}).`)
  }
  if (!body) {
    throw new Error(`Play average import returned an empty response (${response.status}).`)
  }

  return {
    results: Array.isArray(body.results) ? body.results : [],
    errors: Array.isArray(body.errors) ? body.errors : [],
  }
}

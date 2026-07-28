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

export type PackRatingsResult = {
  username: string
  passCount: number
  passes: PackRatingPass[]
}

export const PACK_RATINGS_ENDPOINT = '/api/import/pack-ratings'

type PackRatingsResponse = {
  ok?: boolean
  error?: string
  code?: string
  username?: string
  passCount?: number
  passes?: PackRatingPass[]
}

/**
 * Fetches Real play ratings for a username (rarity floor + boostInfo.progress).
 */
export async function fetchPackRatings(
  username: string,
  signal?: AbortSignal,
): Promise<PackRatingsResult> {
  const trimmed = username.replace(/^@/, '').trim()
  if (!trimmed) {
    throw new Error('Enter a Real username.')
  }

  const response = await fetch(PACK_RATINGS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: trimmed }),
    signal,
  })

  const text = await response.text()
  let body: PackRatingsResponse | null = null
  if (text.trim()) {
    try {
      body = JSON.parse(text) as PackRatingsResponse
    } catch {
      const snippet = text.trim().replace(/\s+/g, ' ').slice(0, 160)
      throw new Error(
        response.ok
          ? `Pack rating import returned invalid JSON: ${snippet}`
          : `Pack rating import failed (${response.status}): ${snippet}`,
      )
    }
  }

  if (!response.ok) {
    throw new Error(body?.error || `Pack rating import failed (${response.status}).`)
  }
  if (!body) {
    throw new Error(`Pack rating import returned an empty response (${response.status}).`)
  }

  const passes = Array.isArray(body.passes) ? body.passes : []
  return {
    username: body.username || trimmed,
    passCount: body.passCount ?? passes.length,
    passes,
  }
}

export function findPackRatingForExternalKey(
  passes: PackRatingPass[],
  externalKey: string,
): PackRatingPass | undefined {
  return passes.find((pass) => pass.externalKey === externalKey)
}

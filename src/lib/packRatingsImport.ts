import { waitWithAbort } from '../../lib/abortablePromise'
import { safeImportFetch } from './safeImportFetch'

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
  startedAt?: string
  username: string
  passCount: number
  passes: PackRatingPass[]
  fetchedAt?: string
  source?: 'real' | 'cache'
}

export const PACK_RATINGS_ENDPOINT = '/api/import/pack-ratings'

type PackRatingsResponse = {
  startedAt?: string
  ok?: boolean
  error?: string
  code?: string
  username?: string
  passCount?: number
  passes?: PackRatingPass[]
  fetchedAt?: string
  source?: 'real' | 'cache'
}

/**
 * Fetches Real play ratings for a username (rarity floor + boostInfo.progress).
 */
async function requestPackRatings(trimmed: string, forceRefresh: boolean): Promise<PackRatingsResult> {
  const response = await safeImportFetch(PACK_RATINGS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: trimmed, ...(forceRefresh ? { forceRefresh: true } : {}) }),
    signal: AbortSignal.timeout(60_000),
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

  if (!Array.isArray(body.passes) || (body.passCount !== undefined && body.passCount !== body.passes.length)) {
    throw new Error('Pack rating import returned invalid or missing ownership data.')
  }
  const passes = body.passes
  return {
    username: body.username || trimmed,
    passCount: body.passCount ?? passes.length,
    passes,
    fetchedAt: body.fetchedAt,
    startedAt: body.startedAt,
    source: body.source === 'cache' || body.source === 'real' ? body.source : undefined,
  }
}

const pendingImports = new Map<string, Promise<PackRatingsResult>>()

export async function fetchPackRatings(
  username: string,
  signal?: AbortSignal,
  options?: { forceRefresh?: boolean },
): Promise<PackRatingsResult> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const normalized = username.trim().replace(/^@/, '').trim().toLowerCase()
  if (!normalized) throw new Error('Enter a Real username.')
  const force = options?.forceRefresh === true
  const key = `${normalized}|${force ? 'fresh' : 'recent'}`
  let pending = pendingImports.get(`${normalized}|fresh`) ?? pendingImports.get(key)
  if (!pending) {
    pending = requestPackRatings(normalized, force).finally(() => pendingImports.delete(key))
    pendingImports.set(key, pending)
  }
  const result = await waitWithAbort(pending, signal)
  return { ...result, passes: result.passes.map((pass) => ({ ...pass })) }
}

export function findPackRatingForExternalKey(
  passes: PackRatingPass[],
  externalKey: string,
): PackRatingPass | undefined {
  return passes.find((pass) => pass.externalKey === externalKey)
}

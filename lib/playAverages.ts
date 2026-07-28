/**
 * Average Real play rating helpers (pack ≈ 3 plays).
 */

/** Player packs contain this many play cards. */
export const PLAYS_PER_PACK = 3

/**
 * Minimum rating gained per pack for estimates.
 * Real packs effectively floor around this; never estimate below it.
 */
export const MIN_RATING_PER_PACK = 10

export type PlayRatingAverage = {
  playCount: number
  ratingSum: number
  /** Mean Real Rating per play (`value`). */
  averagePlayRating: number
  /** Raw averagePlayRating × PLAYS_PER_PACK (before min floor). */
  averageRatingPerPack: number
}

function playRatingValue(play: { value?: string | number | null }): number | null {
  if (play.value === null || play.value === undefined || play.value === '') return null
  const n = typeof play.value === 'number' ? play.value : Number(play.value)
  // Absolute value: pitcher (and other) plays often store batter-centric negatives.
  if (!Number.isFinite(n)) return null
  return Math.abs(n)
}

/**
 * Map display / catalog sport labels to Real `/players/.../sport/{slug}/plays` path slugs.
 * Kept local so play-average imports do not pull the heavy shop-crawl/catalog graph.
 */
export function toRealPlaySportSlug(sport: string): string {
  const raw = sport.trim().toLowerCase()
  if (!raw || raw === 'other') return ''
  if (raw === 'cbb' || raw === 'ncaab' || raw === 'ncaa-mens-basketball') return 'ncaam'
  if (raw === 'fc' || raw === 'soccer') return 'soccer'
  if (raw === 'cfb' || raw === 'ncaafootball' || raw === 'ncaa-football') return 'ncaaf'
  if (raw === 'nba') return 'nba'
  if (raw === 'wnba') return 'wnba'
  if (raw === 'nfl') return 'nfl'
  if (raw === 'mlb') return 'mlb'
  if (raw === 'nhl') return 'nhl'
  if (raw === 'golf') return 'golf'
  if (raw === 'ufc') return 'ufc'
  if (raw === 'ncaam') return 'ncaam'
  if (raw === 'ncaaf') return 'ncaaf'
  return raw
}

/**
 * Average play rating from Real `/plays/top` (or `/plays/recent`) rows (numeric `value`).
 * Each value is taken as absolute before averaging (e.g. −7 → 7).
 */
export function averagePlayRatingsFromPlays(
  plays: ReadonlyArray<{ value?: string | number | null }>,
): PlayRatingAverage | null {
  let ratingSum = 0
  let playCount = 0
  for (const play of plays) {
    const value = playRatingValue(play)
    if (value === null) continue
    ratingSum += value
    playCount += 1
  }
  if (playCount <= 0) return null
  const averagePlayRating = ratingSum / playCount
  return {
    playCount,
    ratingSum,
    averagePlayRating,
    averageRatingPerPack: averagePlayRating * PLAYS_PER_PACK,
  }
}

/**
 * Round estimated rating/pack for UI / estimate divisor.
 * Floors at {@link MIN_RATING_PER_PACK} (packs cannot estimate below 10).
 */
export function ratingPerPackFromPlayAverage(averagePlayRating: number): number {
  const perPack = averagePlayRating * PLAYS_PER_PACK
  if (!Number.isFinite(perPack) || perPack < MIN_RATING_PER_PACK) {
    return MIN_RATING_PER_PACK
  }
  return Math.round(perPack * 10) / 10
}

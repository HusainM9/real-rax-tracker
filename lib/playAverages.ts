/**
 * Average Real play rating helpers (pack ≈ 3 plays).
 */

/** Player packs contain this many play cards. */
export const PLAYS_PER_PACK = 3

export type PlayRatingAverage = {
  playCount: number
  ratingSum: number
  /** Mean Real Rating per play (`value`). */
  averagePlayRating: number
  /** Expected rating gained per pack (= averagePlayRating × PLAYS_PER_PACK). */
  averageRatingPerPack: number
}

function playRatingValue(play: { value?: string | number | null }): number | null {
  const n = typeof play.value === 'number' ? play.value : Number(play.value)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/**
 * Average play rating from Real `/plays/recent` rows (uses numeric `value`).
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

/** Round estimated rating/pack for UI / estimate divisor (≥ 1). */
export function ratingPerPackFromPlayAverage(averagePlayRating: number): number {
  const perPack = averagePlayRating * PLAYS_PER_PACK
  if (!Number.isFinite(perPack) || perPack < 1) return 1
  return Math.max(1, Math.round(perPack * 10) / 10)
}

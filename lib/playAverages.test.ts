import { describe, expect, it } from 'vitest'
import {
  PLAYS_PER_PACK,
  averagePlayRatingsFromPlays,
  ratingPerPackFromPlayAverage,
} from './playAverages'

describe('averagePlayRatingsFromPlays', () => {
  it('averages play values and multiplies by plays-per-pack', () => {
    const result = averagePlayRatingsFromPlays([
      { value: '3' },
      { value: 6 },
      { value: '9.0' },
    ])
    expect(result).toEqual({
      playCount: 3,
      ratingSum: 18,
      averagePlayRating: 6,
      averageRatingPerPack: 18,
    })
    expect(PLAYS_PER_PACK).toBe(3)
  })

  it('skips invalid values', () => {
    const result = averagePlayRatingsFromPlays([
      { value: '2.5' },
      { value: 0 },
      { value: 'nope' },
      { value: null },
      { value: 7.5 },
    ])
    expect(result?.playCount).toBe(2)
    expect(result?.averagePlayRating).toBe(5)
    expect(result?.averageRatingPerPack).toBe(15)
  })

  it('returns null when no valid plays', () => {
    expect(averagePlayRatingsFromPlays([])).toBeNull()
    expect(averagePlayRatingsFromPlays([{ value: 0 }])).toBeNull()
  })
})

describe('ratingPerPackFromPlayAverage', () => {
  it('rounds average × 3 for estimate use', () => {
    expect(ratingPerPackFromPlayAverage(2.979)).toBe(8.9)
    expect(ratingPerPackFromPlayAverage(10 / 3)).toBe(10)
  })
})

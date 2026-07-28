import { describe, expect, it } from 'vitest'
import {
  PLAYS_PER_PACK,
  MIN_RATING_PER_PACK,
  toRealPlaySportSlug,
  averagePlayRatingsFromPlays,
  ratingPerPackFromPlayAverage,
} from './playAverages'

describe('toRealPlaySportSlug', () => {
  it('maps display sports to Real plays path slugs', () => {
    expect(toRealPlaySportSlug('MLB')).toBe('mlb')
    expect(toRealPlaySportSlug('FC')).toBe('soccer')
    expect(toRealPlaySportSlug('CBB')).toBe('ncaam')
    expect(toRealPlaySportSlug('CFB')).toBe('ncaaf')
    expect(toRealPlaySportSlug('Other')).toBe('')
  })
})

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
    expect(ratingPerPackFromPlayAverage(4)).toBe(12)
    expect(ratingPerPackFromPlayAverage(10 / 3)).toBe(10)
  })

  it('floors at 10 when average × 3 would be lower', () => {
    expect(ratingPerPackFromPlayAverage(2.979)).toBe(MIN_RATING_PER_PACK)
    expect(ratingPerPackFromPlayAverage(1)).toBe(10)
    expect(ratingPerPackFromPlayAverage(0)).toBe(10)
  })
})

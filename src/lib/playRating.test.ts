import { describe, expect, it } from 'vitest'
import { absolutePlayRating, playRatingFloor } from './playRating'

describe('playRatingFloor', () => {
  it('returns documented thresholds', () => {
    expect(playRatingFloor('General')).toBe(0)
    expect(playRatingFloor('Legendary 1')).toBe(380)
    expect(playRatingFloor('Mystic 5')).toBe(2220)
    expect(playRatingFloor('Iconic 1')).toBe(3380)
    expect(playRatingFloor('Iconic 2')).toBe(3800)
  })
})

describe('absolutePlayRating', () => {
  it('adds boostInfo.progress on top of the rarity floor', () => {
    expect(absolutePlayRating('Iconic 1', 0)).toBe(3380)
    expect(absolutePlayRating('Iconic 1', 100)).toBe(3480)
    expect(absolutePlayRating('Mystic 10', 70)).toBe(3320)
  })

  it('treats missing progress as zero', () => {
    expect(absolutePlayRating('Legendary 5', undefined)).toBe(1180)
  })
})

import { describe, expect, it } from 'vitest'
import { computeOtdRax, getOtdMultiplier } from './otdRax'

describe('computeOtdRax', () => {
  it('applies player rarity multipliers', () => {
    expect(getOtdMultiplier('nba', 'Rare 1')).toBe(4)
    expect(computeOtdRax(26, 'nba', 'Rare 1')).toBe(104)
    expect(computeOtdRax(14, 'nfl', 'General')).toBe(14)
  })

  it('applies team pass multipliers from Real docs', () => {
    expect(getOtdMultiplier('nba', 'Common', 'team')).toBe(1.2)
    expect(getOtdMultiplier('nba', 'Rare 1', 'team')).toBe(1.6)
    expect(getOtdMultiplier('nba', 'Legendary 1', 'team')).toBe(2.5)
    expect(getOtdMultiplier('nba', 'Iconic 1', 'team')).toBe(6)
    expect(computeOtdRax(20, 'nba', 'Rare 1', 'team')).toBe(32)
  })

  it('uses UFC fighter multipliers for UFC team passes', () => {
    expect(getOtdMultiplier('ufc', 'Common', 'team')).toBe(1.2)
    expect(computeOtdRax(101, 'ufc', 'Common', 'team')).toBe(121)
  })

  it('caps boosted earnings when over the rarity cap', () => {
    expect(computeOtdRax(1000, 'nba', 'Rare 1')).toBe(2000)
    expect(computeOtdRax(3000, 'nba', 'Rare 1', 'team')).toBe(4000)
  })

  it('applies iconic multipliers without a cap', () => {
    expect(computeOtdRax(100, 'nba', 'Iconic 1')).toBe(15000)
    expect(computeOtdRax(100, 'nba', 'Iconic 1', 'team')).toBe(600)
  })
})

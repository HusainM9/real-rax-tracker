import { describe, expect, it } from 'vitest'
import {
  boostAddend,
  parseBoosterCardMultiplier,
  parsePassBoostMultiplier,
  parseRarityMultiplierLabel,
} from './passEarningsBoost'

describe('parsePassBoostMultiplier', () => {
  it('defaults to 1x when no booster is attached', () => {
    expect(parsePassBoostMultiplier(undefined, undefined)).toBe(1)
    expect(parsePassBoostMultiplier(0, '')).toBe(1)
    expect(parsePassBoostMultiplier(null, null)).toBe(1)
  })

  it('reads an explicit booster string like 2x', () => {
    expect(parsePassBoostMultiplier(0, '2x')).toBe(2)
    expect(parsePassBoostMultiplier(3, '1.5x')).toBe(1.5)
    expect(parsePassBoostMultiplier('15x')).toBe(15)
  })

  it('does not treat Real play-rating boostValue as an earnings multiplier', () => {
    expect(parsePassBoostMultiplier(3380.1, '3380.1')).toBe(1)
    expect(parsePassBoostMultiplier(89.6, '89.6')).toBe(1)
    expect(parsePassBoostMultiplier(2)).toBe(1)
  })
})

describe('boostAddend', () => {
  it('adds nothing when there is no booster', () => {
    expect(boostAddend(1)).toBe(0)
    expect(boostAddend(0)).toBe(0)
  })

  it('adds the booster multiplier when one is applied', () => {
    expect(boostAddend(15)).toBe(15)
    expect(boostAddend(2)).toBe(2)
  })
})

describe('parseBoosterCardMultiplier', () => {
  it('reads a booster card multiplier from nested Real info', () => {
    expect(parseBoosterCardMultiplier({ multiplier: '15x' })).toBe(15)
    expect(parseBoosterCardMultiplier({ boostInfo: { multiplier: '2x' } })).toBe(2)
    expect(parseBoosterCardMultiplier(null)).toBe(0)
  })
})

describe('parseRarityMultiplierLabel', () => {
  it('parses Real boostInfo.multiplier strings', () => {
    expect(parseRarityMultiplierLabel('150x')).toBe(150)
    expect(parseRarityMultiplierLabel('1.2x')).toBe(1.2)
    expect(parseRarityMultiplierLabel('')).toBeNull()
  })
})

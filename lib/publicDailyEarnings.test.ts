import { describe, expect, it } from 'vitest'
import {
  calculatePublicPassEarnings,
  currentRealEarningsDay,
  parsePassEarningsMultiplier,
  selectActivePlayerPasses,
} from './publicDailyEarnings'
import type { RealBoosterRarityGroup, RealPass } from './realApi'

function boostedPass(multiplier: string, rarity: number, statBoostKey: string): RealPass {
  return {
    id: 1,
    entityType: 'player',
    entityId: 10,
    sport: 'soccer',
    season: 2026,
    boostInfo: { multiplier, isCardBoosted: true },
    boosterCardInfo: { rarity, statBoostKey },
  }
}

describe('public daily earnings calculation', () => {
  it('keeps every active player pass without relying on Real playstoday filtering', () => {
    const passes: RealPass[] = [
      { id: 1, entityType: 'player', entityId: 10, sport: 'ncaaf', season: 2026, isActive: true, isRefunded: false },
      { id: 2, entityType: 'player', entityId: 11, sport: 'ncaaf', season: 2026, isActive: true, isRefunded: false },
      { id: 3, entityType: 'player', entityId: 12, sport: 'ncaaf', season: 2026, isActive: false, isRefunded: false },
      { id: 4, entityType: 'team', entityId: 13, sport: 'ncaaf', season: 2026, isActive: true, isRefunded: false },
      { id: 5, entityType: 'player', entityId: 14, sport: 'ncaaf', season: 2026, isActive: true, isRefunded: true },
    ]

    expect(selectActivePlayerPasses(passes).map((pass) => pass.id)).toEqual([1, 2])
  })

  it('keeps the prior Eastern day active until the morning reset', () => {
    expect(currentRealEarningsDay(new Date('2026-10-11T10:30:00Z'))).toBe('2026-10-10')
    expect(currentRealEarningsDay(new Date('2026-10-11T11:30:00Z'))).toBe('2026-10-11')
  })

  it('reads the combined card and booster multiplier from Real display text', () => {
    expect(parsePassEarningsMultiplier('165x · PTD · FF')).toBe(165)
    expect(parsePassEarningsMultiplier('3x')).toBe(3)
    expect(parsePassEarningsMultiplier(undefined)).toBe(1)
  })

  it('matches the known projected goal-booster result', () => {
    const rarityGroups: RealBoosterRarityGroup[] = [{
      rarity: 5,
      statBoostKeyInfo: [{
        statBoostKey: '1',
        info: [{ label: 'GOAL', boostValue: '32.5' }],
      }],
    }]
    const result = calculatePublicPassEarnings({
      pass: boostedPass('28x · GOAL', 5, '1'),
      performances: [{ baseEarnings: 21, statValues: [{ type: 1, value: 1 }] }],
      rarityGroups,
    })

    expect(result.totalEarnings).toBe(621)
  })

  it('rounds the final fractional stat boost upward like Real', () => {
    const rarityGroups: RealBoosterRarityGroup[] = [{
      rarity: 4,
      statBoostKeyInfo: [{
        statBoostKey: '17',
        info: [{ label: 'SAVE', boostValue: '6.4' }],
      }],
    }]
    const result = calculatePublicPassEarnings({
      pass: boostedPass('17x · SAVE', 4, '17'),
      performances: [{ baseEarnings: 22, statValues: [{ type: 17, value: '6' }] }],
      rarityGroups,
    })

    expect(result.totalEarnings).toBe(413)
  })

  it('uses the made value from ratio stats', () => {
    const rarityGroups: RealBoosterRarityGroup[] = [{
      rarity: 5,
      statBoostKeyInfo: [{
        statBoostKey: '29',
        info: [{ label: 'DUEL', boostValue: '4' }],
      }],
    }]
    const result = calculatePublicPassEarnings({
      pass: boostedPass('15x · DUEL', 5, '29'),
      performances: [{ baseEarnings: 12, statValues: [{ type: 29, value: '6/9' }] }],
      rarityGroups,
    })

    expect(result.totalEarnings).toBe(204)
  })
})

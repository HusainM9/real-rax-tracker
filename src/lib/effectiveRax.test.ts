import { describe, expect, it } from 'vitest'
import { getBaseRaxEarned, getEffectiveRaxEarned, rarityLabelFromNotes } from './effectiveRax'
import type { PlayerCard, RaxPerformance } from '../types/rax'

function card(overrides: Partial<PlayerCard> = {}): PlayerCard {
  return {
    id: 'card-1',
    name: 'Test Player',
    sport: 'NBA',
    season: '2024-25',
    notes: '',
    createdAt: '2025-01-01T00:00:00.000Z',
    rarityLabel: 'Mystic 10',
    passKind: 'player',
    ...overrides,
  }
}

function performance(overrides: Partial<RaxPerformance> = {}): RaxPerformance {
  return {
    id: 'perf-1',
    cardId: 'card-1',
    claimDay: '2025-08-22',
    raxEarned: 105,
    baseRaxEarned: 1,
    note: '',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('rarityLabelFromNotes', () => {
  it('parses trailing rarity from import notes', () => {
    expect(rarityLabelFromNotes('Imported from @user · Mystic 10')).toBe('Mystic 10')
  })
})

describe('getEffectiveRaxEarned', () => {
  it('returns stored rax when no preview is set', () => {
    expect(getEffectiveRaxEarned(performance(), card())).toBe(105)
  })

  it('recalculates rax when preview rarity is set', () => {
    const preview = card({ simulatedRarityLabel: 'Iconic 20' })
    expect(getEffectiveRaxEarned(performance(), preview)).toBe(250)
  })

  it('reverse-estimates base rax from current rarity when base is missing', () => {
    const preview = card({ simulatedRarityLabel: 'Iconic 1' })
    const perf = performance({ baseRaxEarned: undefined, raxEarned: 105 })
    expect(getEffectiveRaxEarned(perf, preview)).toBe(150)
  })
})

describe('getBaseRaxEarned', () => {
  it('returns stored base rax for imported performances', () => {
    expect(getBaseRaxEarned(performance({ baseRaxEarned: 1, raxEarned: 105 }), card())).toBe(1)
  })

  it('reverse-estimates from rarity when base is missing', () => {
    expect(
      getBaseRaxEarned(performance({ baseRaxEarned: undefined, raxEarned: 105 }), card()),
    ).toBe(1)
  })

  it('ignores rarity preview', () => {
    const previewCard = card({ simulatedRarityLabel: 'Iconic 20' })
    expect(getBaseRaxEarned(performance(), previewCard)).toBe(1)
  })
})

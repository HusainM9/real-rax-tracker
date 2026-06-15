import { describe, expect, it } from 'vitest'
import { applyCardRarityChange } from './cardRarity'
import type { PlayerCard, RaxPerformance, RaxTrackerData } from '../types/rax'

function card(overrides: Partial<PlayerCard> = {}): PlayerCard {
  return {
    id: 'card-1',
    name: 'Test Player',
    sport: 'NBA',
    season: '2024-25',
    notes: '',
    rarityLabel: 'Legendary 1',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function performance(overrides: Partial<RaxPerformance> = {}): RaxPerformance {
  return {
    id: 'perf-1',
    cardId: 'card-1',
    claimDay: '01-15',
    raxEarned: 105,
    note: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function data(overrides: Partial<RaxTrackerData> = {}): RaxTrackerData {
  return {
    version: 1,
    settings: { proBonusEnabled: false, savedUsername: '' },
    cards: [card()],
    performances: [performance()],
    potentialCards: [],
    savedCardProfiles: [],
    ...overrides,
  }
}

describe('applyCardRarityChange', () => {
  it('recalculates earnings and clears preview rarity', () => {
    const next = applyCardRarityChange(
      data({
        cards: [card({ simulatedRarityLabel: 'Iconic 20' })],
        performances: [performance({ baseRaxEarned: 4, raxEarned: 100 })],
      }),
      'card-1',
      'Iconic 1',
    )

    expect(next?.cards[0]?.rarityLabel).toBe('Iconic 1')
    expect(next?.cards[0]?.simulatedRarityLabel).toBeUndefined()
    expect(next?.performances[0]?.raxEarned).toBe(600)
    expect(next?.performances[0]?.baseRaxEarned).toBe(4)
  })
})

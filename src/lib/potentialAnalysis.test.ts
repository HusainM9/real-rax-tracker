import { describe, expect, it } from 'vitest'
import { analyzePotentialCard } from './potentialAnalysis'
import type { PlayerCard, RaxPerformance, RaxTrackerData } from '../types/rax'

function card(id: string, name: string): PlayerCard {
  return {
    id,
    name,
    sport: 'NBA',
    season: '2025-26',
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function perf(id: string, cardId: string, rax: number, claimDay: string): RaxPerformance {
  return {
    id,
    cardId,
    claimDay,
    raxEarned: rax,
    note: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('analyzePotentialCard', () => {
  const data: RaxTrackerData = {
    version: 1,
    settings: { proBonusEnabled: false, savedUsername: '' },
    cards: [card('c1', 'Owned A'), card('c2', 'Owned B'), card('c3', 'Owned C')],
    performances: [
      perf('p1', 'c1', 30, '2026-03-01'),
      perf('p2', 'c2', 25, '2026-03-01'),
      perf('p3', 'c3', 10, '2026-03-01'),
    ],
    potentialCards: [],
  }

  it('reports overlap when a potential card would be third in sport', () => {
    const result = analyzePotentialCard(
      data,
      { name: 'Prospect', sport: 'NBA', season: '2025-26' },
      [{ claimDay: '2026-03-01', raxEarned: 15, note: '' }],
    )

    expect(result?.overlapRax).toBe(15)
    expect(result?.claimableRax).toBe(0)
  })

  it('applies preview rarity OTD multipliers to pasted base rows', () => {
    const rows = [{ claimDay: '2026-03-01', raxEarned: 15, baseRaxEarned: 15, note: '' }]
    const base = analyzePotentialCard(
      data,
      { name: 'Prospect', sport: 'NBA', season: '2025-26' },
      rows,
    )
    const iconic = analyzePotentialCard(
      data,
      { name: 'Prospect', sport: 'NBA', season: '2025-26', simulatedRarityLabel: 'Iconic 1' },
      rows,
    )

    expect(base?.candidates[0]?.candidate.performance.raxEarned).toBe(15)
    expect(iconic?.candidates[0]?.candidate.performance.raxEarned).toBeGreaterThan(15)
  })
})

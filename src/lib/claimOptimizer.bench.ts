import { bench, describe } from 'vitest'
import { computeYearRollup } from './claimOptimizer'
import { analyzeOwnedIconicUpgradeImpacts } from './passRecommendation'
import type { RaxTrackerData } from '../types/rax'

// Synthetic collection: enough passes and daily rows to expose repeated full-collection work.
const cards: RaxTrackerData['cards'] = Array.from({ length: 600 }, (_, index) => ({
  id: `card-${index}`, name: `Player ${index}`, sport: index % 2 ? 'NBA' : 'NHL',
  season: '2025-26', notes: '', createdAt: '2026-01-01T00:00:00.000Z',
}))
const performances: RaxTrackerData['performances'] = cards.flatMap((card, cardIndex) =>
  Array.from({ length: 40 }, (_, day) => ({
    id: `${card.id}-${day}`, cardId: card.id,
    claimDay: `2026-${String(Math.floor(day / 28) + 1).padStart(2, '0')}-${String(day % 28 + 1).padStart(2, '0')}`,
    raxEarned: (cardIndex + day) % 100 + 1, note: '', createdAt: '2026-01-01T00:00:00.000Z',
  })),
)
const data: RaxTrackerData = {
  version: 1, settings: { proBonusEnabled: true, savedUsername: '' }, cards, performances,
  potentialCards: [], savedCardProfiles: [],
}

describe('collection comparison, 600 passes and 24,000 performances', () => {
  bench('four rollups (previous comparison)', () => {
    computeYearRollup(data).totalGuaranteedRax
    computeYearRollup(data).totalGuaranteedRax
    computeYearRollup(data).totalClaimableRax
    computeYearRollup(data).totalClaimableRax
  })
  bench('two rollups (shared comparison totals)', () => {
    const before = computeYearRollup(data)
    const after = computeYearRollup(data)
    void (after.totalGuaranteedRax - before.totalGuaranteedRax)
    void (after.totalClaimableRax - before.totalClaimableRax)
  })
})

describe('owned upgrade impact, 15 candidates', () => {
  const candidates = cards.slice(0, 15).map((card) => ({
    key: card.id, name: card.name, sport: card.sport, season: card.season, card,
  }))
  bench('analyze all candidates', () => {
    analyzeOwnedIconicUpgradeImpacts(data, candidates)
  })
})

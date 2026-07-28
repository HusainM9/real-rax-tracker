import { describe, expect, it } from 'vitest'
import {
  addSellExcludedCardId,
  isCardSellExcluded,
  listSellExcludedCards,
  removeSellExcludedCardId,
  withoutSellExcludedCards,
} from './sellExcludedPasses'
import { analyzeRemovedCard, rankAllRemovedCards } from './removeCardAnalysis'
import { createEmptyData, normalizeData } from './storage'
import type { RaxTrackerData } from '../types/rax'

function sampleData(): RaxTrackerData {
  return {
    ...createEmptyData(),
    cards: [
      {
        id: 'keep',
        name: 'Keep Player',
        sport: 'NBA',
        season: '2025-26',
        notes: '',
        rarityLabel: 'Legendary 1',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'sentiment',
        name: 'Sentiment Player',
        sport: 'NBA',
        season: '2025-26',
        notes: '',
        rarityLabel: 'Legendary 1',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    performances: [
      {
        id: 'p-keep',
        cardId: 'keep',
        claimDay: '2025-08-22',
        raxEarned: 200,
        note: '',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'p-sentiment',
        cardId: 'sentiment',
        claimDay: '2025-08-22',
        raxEarned: 150,
        note: '',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }
}

describe('sellExcludedPasses', () => {
  it('adds and removes sell-excluded card ids without duplicates', () => {
    let data = addSellExcludedCardId(sampleData(), 'sentiment')
    data = addSellExcludedCardId(data, 'sentiment')
    expect(data.sellExcludedCardIds).toEqual(['sentiment'])
    expect(isCardSellExcluded(data, 'sentiment')).toBe(true)

    data = removeSellExcludedCardId(data, 'sentiment')
    expect(data.sellExcludedCardIds).toEqual([])
  })

  it('prunes the card from saved sell rankings when excluded', () => {
    const withRankings: RaxTrackerData = {
      ...sampleData(),
      savedSellRankings: {
        calculatedAt: '2026-01-01T00:00:00.000Z',
        skippedWithoutEarnings: 0,
        skippedTeamPasses: 0,
        skippedPlayerPasses: [],
        rows: [
          {
            cardId: 'sentiment',
            name: 'Sentiment Player',
            sport: 'NBA',
            season: '2025-26',
            claimableNow: 150,
            lostClaimableRax: 150,
            freedClaimableRax: 0,
            netClaimableDelta: -150,
          },
          {
            cardId: 'keep',
            name: 'Keep Player',
            sport: 'NBA',
            season: '2025-26',
            claimableNow: 200,
            lostClaimableRax: 200,
            freedClaimableRax: 0,
            netClaimableDelta: -200,
          },
        ],
      },
    }

    const next = addSellExcludedCardId(withRankings, 'sentiment')
    expect(next.savedSellRankings?.rows.map((row) => row.cardId)).toEqual(['keep'])
  })

  it('lists excluded cards still present in the collection', () => {
    const data = addSellExcludedCardId(sampleData(), 'sentiment')
    expect(listSellExcludedCards(data).map((card) => card.id)).toEqual(['sentiment'])
  })

  it('withoutSellExcludedCards strips excluded passes from the sell baseline', () => {
    const data = addSellExcludedCardId(sampleData(), 'sentiment')
    const stripped = withoutSellExcludedCards(data)
    expect(stripped.cards.map((card) => card.id)).toEqual(['keep'])
    expect(stripped.performances.every((row) => row.cardId === 'keep')).toBe(true)
    expect(data.cards).toHaveLength(2)
  })
})

describe('normalizeData sellExcludedCardIds', () => {
  it('defaults missing sellExcludedCardIds to an empty array', () => {
    const normalized = normalizeData({
      version: 1,
      settings: { proBonusEnabled: true, savedUsername: '' },
      cards: [],
      performances: [],
      potentialCards: [],
      savedCardProfiles: [],
    })
    expect(normalized.sellExcludedCardIds).toEqual([])
  })

  it('hydrates and prunes ids not in the collection', () => {
    const normalized = normalizeData({
      ...createEmptyData(),
      cards: [
        {
          id: 'keep-me',
          name: 'Keep',
          sport: 'NBA',
          season: '2025-26',
          notes: '',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      sellExcludedCardIds: ['keep-me', 'keep-me', 'gone', '', 12],
    })
    expect(normalized.sellExcludedCardIds).toEqual(['keep-me'])
  })
})

describe('sell rankings respect sellExcludedCardIds', () => {
  it('omits excluded passes from bulk rankings and single-card analysis', () => {
    const data = addSellExcludedCardId(sampleData(), 'sentiment')
    const ranked = rankAllRemovedCards(data)
    expect(ranked.rankings.map((row) => row.analysis.card.id)).toEqual(['keep'])
    expect(analyzeRemovedCard(data, 'sentiment')).toBeNull()
    expect(analyzeRemovedCard(data, 'keep')).not.toBeNull()
  })
})

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
        externalKey: '1|2025|NBA',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'sentiment',
        name: 'Sentiment Player',
        sport: 'NBA',
        season: '2025-26',
        notes: '',
        rarityLabel: 'Legendary 1',
        externalKey: '2|2025|NBA',
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
  it('adds and removes sell-excluded pass keys without duplicates', () => {
    let data = addSellExcludedCardId(sampleData(), 'sentiment')
    data = addSellExcludedCardId(data, 'sentiment')
    expect(data.sellExcludedPassKeys).toEqual(['2|2025|NBA'])
    expect(data.sellExcludedCardIds).toEqual([])
    expect(isCardSellExcluded(data, 'sentiment')).toBe(true)

    data = removeSellExcludedCardId(data, 'sentiment')
    expect(data.sellExcludedPassKeys).toEqual([])
  })

  it('keeps exclusions when card ids change but externalKey matches', () => {
    const excluded = addSellExcludedCardId(sampleData(), 'sentiment')
    const remapped: RaxTrackerData = {
      ...excluded,
      cards: excluded.cards.map((card) =>
        card.id === 'sentiment' ? { ...card, id: 'sentiment-new' } : card,
      ),
      performances: excluded.performances.map((row) =>
        row.cardId === 'sentiment' ? { ...row, cardId: 'sentiment-new' } : row,
      ),
    }
    expect(isCardSellExcluded(remapped, 'sentiment-new')).toBe(true)
    expect(listSellExcludedCards(remapped).map((card) => card.id)).toEqual(['sentiment-new'])
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

describe('normalizeData sellExcludedPassKeys', () => {
  it('defaults missing sellExcludedPassKeys to an empty array', () => {
    const normalized = normalizeData({
      version: 1,
      settings: { proBonusEnabled: true, savedUsername: '' },
      cards: [],
      performances: [],
      potentialCards: [],
      savedCardProfiles: [],
    })
    expect(normalized.sellExcludedPassKeys).toEqual([])
    expect(normalized.sellExcludedCardIds).toEqual([])
  })

  it('migrates legacy card ids to external keys and drops unknown ids', () => {
    const normalized = normalizeData({
      ...createEmptyData(),
      cards: [
        {
          id: 'keep-me',
          name: 'Keep',
          sport: 'NBA',
          season: '2025-26',
          notes: '',
          externalKey: '9|2025|NBA',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      sellExcludedCardIds: ['keep-me', 'keep-me', 'gone', '', 12],
    })
    expect(normalized.sellExcludedPassKeys).toEqual(['9|2025|NBA'])
    expect(normalized.sellExcludedCardIds).toEqual([])
  })
})

describe('sell rankings respect sellExcludedPassKeys', () => {
  it('omits excluded passes from bulk rankings and single-card analysis', () => {
    const data = addSellExcludedCardId(sampleData(), 'sentiment')
    const ranked = rankAllRemovedCards(data)
    expect(ranked.rankings.map((row) => row.analysis.card.id)).toEqual(['keep'])
    expect(analyzeRemovedCard(data, 'sentiment')).toBeNull()
    expect(analyzeRemovedCard(data, 'keep')).not.toBeNull()
  })
})

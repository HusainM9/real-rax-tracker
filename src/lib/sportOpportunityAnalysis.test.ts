import { describe, expect, it } from 'vitest'
import type { PlayerCard, RaxPerformance, RaxTrackerData } from '../types/rax'
import {
  buildSportOpportunityRow,
  computeSportCollectionStats,
  sortSportOpportunityRows,
  topSportOpportunityFocus,
} from './sportOpportunityAnalysis'
import type { PassRecommendationBundle, PassRecommendationResult } from './passRecommendation'

function card(
  id: string,
  name: string,
  externalKey: string,
  rarityLabel: string,
  sport: PlayerCard['sport'],
): PlayerCard {
  return {
    id,
    name,
    sport,
    season: '2025-26',
    notes: '',
    externalKey,
    rarityLabel,
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

const data: RaxTrackerData = {
  version: 1,
  cards: [],
  performances: [],
  potentialCards: [],
  savedCardProfiles: [],
  settings: { proBonusEnabled: false, savedUsername: '' },
}

const collection = {
  ownedCards: 2,
  currentClaimableRax: 120,
  overlapRax: 40,
}

function emptyRanked(): PassRecommendationResult {
  return {
    rows: [],
    skippedOwnedIconic: 0,
    skippedNoRows: 0,
    skippedAdjusted: 0,
    analyzedCount: 0,
    prefilterTrimmed: 0,
  }
}

describe('sportOpportunityAnalysis', () => {
  it('computes per-sport collection stats from saved cards', () => {
    const tracker = {
      ...data,
      cards: [
        card('c1', 'Alpha', 'a|2025|NBA', 'Iconic 1', 'NBA'),
        card('c2', 'Beta', 'b|2025|NFL', 'Legendary 1', 'NFL'),
      ],
      performances: [perf('p1', 'c1', 50, '2026-03-01'), perf('p2', 'c2', 30, '2026-03-01')],
    }

    const stats = computeSportCollectionStats(tracker)
    expect(stats.get('NBA')?.ownedCards).toBe(1)
    expect(stats.get('NFL')?.ownedCards).toBe(1)
    expect(stats.get('FC')?.ownedCards).toBe(0)
  })

  it('buildSportOpportunityRow maps ranked and bundle results', () => {
    const ranked: PassRecommendationResult = {
      ...emptyRanked(),
      analyzedCount: 2,
      rows: [
        {
          externalKey: 'high|2025|NFL',
          name: 'High',
          sport: 'NFL',
          season: '2025',
          seasonYear: 2025,
          passKind: 'player',
          totalBaseRax: 100,
          iconic1TotalRax: 100,
          rowCount: 1,
          newClaimableRax: 90,
          displacedRax: 10,
          overlapRax: 0,
          netClaimableDelta: 80,
          netGuaranteedDelta: 70,
        },
      ],
    }
    const bundle: PassRecommendationBundle = {
      picks: ranked.rows,
      combinedNetDelta: 80,
    }

    const row = buildSportOpportunityRow('NFL', collection, 12, ranked, bundle)
    expect(row.greedyCombinedNet).toBe(80)
    expect(row.bestSingleNet).toBe(80)
    expect(row.bestSinglePassLabel).toBe('High · 2025')
    expect(row.greedyPickLabels).toEqual(['High · 2025'])
  })

  it('sortSportOpportunityRows prefers higher greedy combined net', () => {
    const rows = sortSportOpportunityRows([
      {
        sport: 'NBA',
        ownedCards: 1,
        currentClaimableRax: 50,
        overlapRax: 0,
        greedyCombinedNet: 100,
        greedyPickCount: 1,
        greedyPickLabels: ['A · 2024-25'],
        bestSingleNet: 100,
        bestSinglePassLabel: 'A · 2024-25',
        catalogPassesScreened: 10,
        candidatesAnalyzed: 5,
      },
      {
        sport: 'NFL',
        ownedCards: 2,
        currentClaimableRax: 200,
        overlapRax: 80,
        greedyCombinedNet: 250,
        greedyPickCount: 2,
        greedyPickLabels: ['B · 2024-25', 'C · 2023-24'],
        bestSingleNet: 150,
        bestSinglePassLabel: 'B · 2024-25',
        catalogPassesScreened: 20,
        candidatesAnalyzed: 8,
      },
    ])

    expect(rows[0]?.sport).toBe('NFL')
  })

  it('topSportOpportunityFocus returns the best positive greedy sport', () => {
    const focus = topSportOpportunityFocus([
      {
        sport: 'NBA',
        ownedCards: 0,
        currentClaimableRax: 0,
        overlapRax: 0,
        greedyCombinedNet: 0,
        greedyPickCount: 0,
        greedyPickLabels: [],
        bestSingleNet: 20,
        bestSinglePassLabel: 'Solo · 2022',
        catalogPassesScreened: 5,
        candidatesAnalyzed: 3,
      },
      {
        sport: 'NFL',
        ownedCards: 1,
        currentClaimableRax: 10,
        overlapRax: 5,
        greedyCombinedNet: 120,
        greedyPickCount: 2,
        greedyPickLabels: ['One · 2024', 'Two · 2023'],
        bestSingleNet: 70,
        bestSinglePassLabel: 'One · 2024',
        catalogPassesScreened: 8,
        candidatesAnalyzed: 4,
      },
    ])

    expect(focus?.sport).toBe('NFL')
  })
})

import { describe, expect, it } from 'vitest'
import { analyzePotentialCard } from './potentialAnalysis'
import {
  analyzeCatalogCandidate,
  filterRecommendationProfiles,
  greedyPickBundle,
  isAtLeastIconic1Rarity,
  netClaimableDelta,
  prefilterRecommendationProfiles,
  rankCatalogRecommendations,
  RECOMMENDATION_SIMULATED_RARITY,
  recommendationCapsForSport,
  seasonLabelIncluded,
  selectSummariesForBulkFetch,
  shouldSkipRecommendationPass,
} from './passRecommendation'
import { type CatalogImportProfile, type CatalogSearchResult } from './catalogApi'
import type { PlayerCard, RaxPerformance, RaxTrackerData } from '../types/rax'

function card(
  id: string,
  name: string,
  externalKey?: string,
  rarityLabel?: string,
): PlayerCard {
  return {
    id,
    name,
    sport: 'NBA',
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

function catalogProfile(
  externalKey: string,
  name: string,
  rows: Array<{ claimDay: string; baseRaxEarned: number }>,
): CatalogImportProfile {
  const totalBaseRax = rows.reduce((sum, row) => sum + row.baseRaxEarned, 0)
  return {
    externalKey,
    entityId: 1,
    passKind: 'player',
    sport: 'NBA',
    seasonYear: 2025,
    seasonLabel: '2025-26',
    name,
    cachedAt: '2026-01-01T00:00:00.000Z',
    rowCount: rows.length,
    totalBaseRax,
    rows,
  }
}

function summary(externalKey: string, name: string, totalBaseRax: number): CatalogSearchResult {
  return {
    externalKey,
    entityId: 1,
    passKind: 'player',
    sport: 'NBA',
    seasonYear: 2025,
    seasonLabel: '2025-26',
    name,
    cachedAt: '2026-01-01T00:00:00.000Z',
    rowCount: 1,
    totalBaseRax,
  }
}

describe('passRecommendation', () => {
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
    savedCardProfiles: [],
  }

  it('netClaimableDelta matches analyzePotentialCard output', () => {
    const analysis = analyzePotentialCard(
      data,
      { name: 'Prospect', sport: 'NBA', season: '2025-26' },
      [{ claimDay: '2026-03-01', raxEarned: 28, note: '' }],
    )
    expect(analysis).not.toBeNull()
    expect(netClaimableDelta(analysis!)).toBe(analysis!.claimableRax - analysis!.displacedRax)
  })

  it('isAtLeastIconic1Rarity matches Iconic tier labels', () => {
    expect(isAtLeastIconic1Rarity('Iconic 1')).toBe(true)
    expect(isAtLeastIconic1Rarity('Legendary 1')).toBe(false)
    expect(isAtLeastIconic1Rarity('Mystic 1')).toBe(false)
  })

  it('recommendationCapsForSport gives MLB a larger margin', () => {
    expect(recommendationCapsForSport('NBA').bulkFetchCap).toBe(1000)
    expect(recommendationCapsForSport('MLB').bulkFetchCap).toBe(2000)
    expect(recommendationCapsForSport('MLB').analysisCap).toBeGreaterThan(
      recommendationCapsForSport('NBA').analysisCap,
    )
  })

  it('skips only collection passes already at Iconic 1+', () => {
    const profiles = [
      catalogProfile('owned-iconic|2025|NBA', 'Owned iconic', [
        { claimDay: '2026-03-01', baseRaxEarned: 50 },
      ]),
      catalogProfile('owned-leg|2025|NBA', 'Owned legendary', [
        { claimDay: '2026-03-01', baseRaxEarned: 40 },
      ]),
      catalogProfile('new|2025|NBA', 'New pass', [{ claimDay: '2026-03-01', baseRaxEarned: 20 }]),
      catalogProfile('empty|2025|NBA', 'Empty pass', []),
    ]
    const ownedData: RaxTrackerData = {
      ...data,
      cards: [
        ...data.cards,
        card('owned-iconic', 'Owned iconic', 'owned-iconic|2025|NBA', 'Iconic 1'),
        card('owned-leg', 'Owned legendary', 'owned-leg|2025|NBA', 'Legendary 1'),
      ],
    }

    expect(shouldSkipRecommendationPass(ownedData, 'owned-iconic|2025|NBA')).toBe(true)
    expect(shouldSkipRecommendationPass(ownedData, 'owned-leg|2025|NBA')).toBe(false)

    const filtered = filterRecommendationProfiles(ownedData, profiles)
    expect(filtered.skippedOwnedIconic).toBe(1)
    expect(filtered.skippedNoRows).toBe(1)
    expect(filtered.candidates.map((item) => item.externalKey).sort()).toEqual([
      'new|2025|NBA',
      'owned-leg|2025|NBA',
    ])
  })

  it('selectSummariesForBulkFetch caps and skips iconic-owned passes', () => {
    const ownedData: RaxTrackerData = {
      ...data,
      cards: [...data.cards, card('owned', 'Owned iconic', 'owned|2025|NBA', 'Iconic 2')],
    }
    const summaries = [
      summary('owned|2025|NBA', 'Owned iconic', 999),
      summary('a|2025|NBA', 'A', 100),
      summary('b|2025|NBA', 'B', 50),
    ]

    const selected = selectSummariesForBulkFetch(ownedData, summaries, { cap: 1 })
    expect(selected.skippedOwnedIconic).toBe(1)
    expect(selected.keys).toEqual(['a|2025|NBA'])
    expect(selected.fetchTrimmed).toBe(1)
  })

  it('filters by excluded season labels', () => {
    const profiles = [
      catalogProfile('a|2025|NBA', '2025 pass', [{ claimDay: '2026-03-01', baseRaxEarned: 10 }]),
      {
        ...catalogProfile('b|2024|NBA', '2024 pass', [{ claimDay: '2026-03-01', baseRaxEarned: 10 }]),
        seasonYear: 2024,
        seasonLabel: '2024-25',
      },
    ]

    const filtered = filterRecommendationProfiles(data, profiles, {
      excludedSeasonLabels: ['2024-25'],
    })
    expect(filtered.candidates.map((item) => item.externalKey)).toEqual(['a|2025|NBA'])
  })

  it('seasonLabelIncluded respects excluded labels', () => {
    expect(seasonLabelIncluded('2024-25', ['2023-24'])).toBe(true)
    expect(seasonLabelIncluded('2024-25', ['2024-25'])).toBe(false)
    expect(seasonLabelIncluded('2024-25')).toBe(true)
  })

  it('filters NFL seasons independently when labels share a catalog year', () => {
    const current = {
      ...catalogProfile('current|2025|NFL', 'Current', [{ claimDay: '2026-03-01', baseRaxEarned: 10 }]),
      sport: 'NFL',
      seasonYear: 2025,
      seasonLabel: '2025-26',
    }
    const prior = {
      ...catalogProfile('prior|2025|NFL', 'Prior', [{ claimDay: '2026-03-01', baseRaxEarned: 8 }]),
      sport: 'NFL',
      seasonYear: 2025,
      seasonLabel: '2024-25',
    }

    const filtered = filterRecommendationProfiles(data, [current, prior], {
      excludedSeasonLabels: ['2024-25'],
    })
    expect(filtered.candidates.map((item) => item.externalKey)).toEqual(['current|2025|NFL'])
  })

  it('filters FC passes by season label when multiple labels share a year', () => {
    const current = {
      ...catalogProfile('current|2025|FC', 'Current', [{ claimDay: '2026-03-01', baseRaxEarned: 10 }]),
      sport: 'FC',
      seasonYear: 2025,
      seasonLabel: '2025',
    }
    const prior = {
      ...catalogProfile('prior|2025|FC', 'Prior', [{ claimDay: '2026-03-01', baseRaxEarned: 8 }]),
      sport: 'FC',
      seasonYear: 2025,
      seasonLabel: '2024-25',
    }

    const filtered = filterRecommendationProfiles(data, [current, prior], {
      excludedSeasonLabels: ['2024-25'],
    })
    expect(filtered.candidates.map((item) => item.externalKey)).toEqual(['current|2025|FC'])
  })

  it('prefilterRecommendationProfiles keeps top iconic1 earners', () => {
    const profiles = [
      catalogProfile('low|2025|NBA', 'Low', [{ claimDay: '2026-03-01', baseRaxEarned: 1 }]),
      catalogProfile('high|2025|NBA', 'High', [{ claimDay: '2026-03-01', baseRaxEarned: 100 }]),
    ]
    const { profiles: kept, trimmed } = prefilterRecommendationProfiles(profiles, 1)
    expect(trimmed).toBe(1)
    expect(kept[0]?.externalKey).toBe('high|2025|NBA')
  })

  it('ranks candidates by net claimable delta at Iconic 1', () => {
    const profiles = [
      catalogProfile('low|2025|NBA', 'Low value', [{ claimDay: '2026-03-01', baseRaxEarned: 12 }]),
      catalogProfile('high|2025|NBA', 'High value', [{ claimDay: '2026-03-01', baseRaxEarned: 35 }]),
    ]

    const ranked = rankCatalogRecommendations(data, profiles)
    expect(ranked.rows[0]?.name).toBe('High value')
    expect(ranked.rows[0]?.rarityLabel).toBe(RECOMMENDATION_SIMULATED_RARITY)
    expect(ranked.rows[0]?.netClaimableDelta).toBeGreaterThan(ranked.rows[1]?.netClaimableDelta ?? 0)
  })

  it('greedy bundle re-evaluates after each pick', () => {
    const spreadData: RaxTrackerData = {
      ...data,
      performances: [
        perf('p1', 'c1', 30, '2026-03-01'),
        perf('p2', 'c2', 25, '2026-03-01'),
        perf('p3', 'c3', 10, '2026-04-15'),
        perf('p4', 'c1', 40, '2026-04-15'),
        perf('p5', 'c2', 35, '2026-04-15'),
      ],
    }

    const dayOneStar = catalogProfile('star|2025|NBA', 'Day one star', [
      { claimDay: '2026-03-01', baseRaxEarned: 32 },
    ])
    const dayTwoStar = catalogProfile('april|2025|NBA', 'April star', [
      { claimDay: '2026-04-15', baseRaxEarned: 50 },
    ])
    const filler = catalogProfile('filler|2025|NBA', 'Filler', [
      { claimDay: '2026-05-01', baseRaxEarned: 5 },
    ])

    const bundle = greedyPickBundle(spreadData, [filler, dayOneStar, dayTwoStar], 2)
    expect(bundle.picks.length).toBe(2)
    expect(bundle.picks[0]?.name).toBe('April star')
    expect(bundle.combinedNetDelta).toBe(
      bundle.picks.reduce((sum, row) => sum + row.netClaimableDelta, 0),
    )
  })

  it('analyzeCatalogCandidate returns null for profiles without rows', () => {
    expect(
      analyzeCatalogCandidate(data, catalogProfile('empty|2025|NBA', 'Empty', [])),
    ).toBeNull()
  })
})

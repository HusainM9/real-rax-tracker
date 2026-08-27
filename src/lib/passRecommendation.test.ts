import { describe, expect, it } from 'vitest'
import { analyzePotentialCard } from './potentialAnalysis'
import {
  analyzeCatalogCandidate,
  analyzeIconic20CheckerImpacts,
  analyzeOwnedIconicUpgradeImpacts,
  applyRecommendationBaseline,
  catalogProfileToIconic20CheckerCandidate,
  catalogProfileToParsedRows,
  defaultRankExcludedSportSeasonKeys,
  DEFAULT_RANK_EXCLUDED_SPORT_SEASONS,
  filterRankCatalogSports,
  filterRecommendationProfiles,
  greedyPickBundle,
  isAtLeastIconic1Rarity,
  isIconicBelowLevel,
  isPassInRecommendationAdjustments,
  netClaimableDelta,
  ownedCardToIconic20CheckerCandidate,
  ownedCardToIconicUpgradeCandidate,
  passSeasonIncluded,
  prefilterRecommendationProfiles,
  normalizeBestDayParam,
  rankCatalogRecommendations,
  rankCatalogRecommendationsForDay,
  rankCatalogRecommendationsForMonth,
  RECOMMENDATION_SIMULATED_RARITY,
  recommendationAdjustmentFromPass,
  recommendationCapsForAllSports,
  recommendationCapsForSport,
  recommendationCapsForSports,
  resolveProfileForRecommendationAdjustment,
  sportSeasonFilterKey,
  selectSummariesForBulkFetch,
  shouldSkipRecommendationPass,
  topRecommendationRowsPerSport,
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

  it('uses catalog daily rows as stored without re-filtering by claim day', () => {
    const profile: CatalogImportProfile = {
      ...catalogProfile('300|2025|NFL', 'Derrick Henry', [
        { claimDay: '2024-09-08', baseRaxEarned: 12 },
        { claimDay: '2023-09-10', baseRaxEarned: 21 },
      ]),
      sport: 'NFL',
      seasonYear: 2024,
      seasonLabel: '2024-25',
    }
    const rows = catalogProfileToParsedRows(profile)
    expect(rows.map((row) => row.claimDay)).toEqual(['2024-09-08', '2023-09-10'])
  })

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

  it('recommendationCapsForAllSports sums per-sport limits', () => {
    const all = recommendationCapsForAllSports()
    const subset = recommendationCapsForSports(['NBA', 'MLB'])
    expect(all.bulkFetchCap).toBeGreaterThan(recommendationCapsForSport('MLB').bulkFetchCap)
    expect(all.analysisCap).toBeGreaterThan(recommendationCapsForSport('MLB').analysisCap)
    expect(subset.bulkFetchCap).toBe(
      recommendationCapsForSport('NBA').bulkFetchCap + recommendationCapsForSport('MLB').bulkFetchCap,
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

    expect(
      shouldSkipRecommendationPass(
        ownedData,
        catalogProfile('owned-iconic|2025|NBA', 'Owned iconic', [{ claimDay: '2026-03-01', baseRaxEarned: 20 }]),
      ),
    ).toBe(true)
    expect(
      shouldSkipRecommendationPass(
        ownedData,
        catalogProfile('owned-leg|2025|NBA', 'Owned legendary', [{ claimDay: '2026-03-01', baseRaxEarned: 20 }]),
      ),
    ).toBe(false)

    const filtered = filterRecommendationProfiles(ownedData, profiles)
    expect(filtered.skippedOwnedIconic).toBe(1)
    expect(filtered.skippedNoRows).toBe(1)
    expect(filtered.candidates.map((item) => item.externalKey).sort()).toEqual([
      'new|2025|NBA',
      'owned-leg|2025|NBA',
    ])
  })

  it('skips iconic-owned NFL passes when the owned card season is stored as end year', () => {
    const catalog = {
      ...catalogProfile('12345|2024|NFL', 'Ceedee Lamb', [{ claimDay: '2024-01-01', baseRaxEarned: 10 }]),
      sport: 'NFL',
      seasonYear: 2024,
      seasonLabel: '2023-24',
    }
    const ownedData: RaxTrackerData = {
      ...data,
      cards: [
        ...data.cards,
        {
          ...card('lamb', 'Ceedee Lamb', '12345|2024|NFL', 'Iconic 1'),
          sport: 'NFL',
          season: '2024',
        },
      ],
    }
    expect(shouldSkipRecommendationPass(ownedData, catalog)).toBe(true)
    expect(filterRecommendationProfiles(ownedData, [catalog]).candidates).toHaveLength(0)
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

  it('filters by excluded sport + season keys', () => {
    const profiles = [
      catalogProfile('a|2025|NBA', '2025 pass', [{ claimDay: '2026-03-01', baseRaxEarned: 10 }]),
      {
        ...catalogProfile('b|2024|NBA', '2024 pass', [{ claimDay: '2026-03-01', baseRaxEarned: 10 }]),
        seasonYear: 2024,
        seasonLabel: '2024-25',
      },
    ]

    const filtered = filterRecommendationProfiles(data, profiles, {
      excludedSportSeasonKeys: [sportSeasonFilterKey('NBA', '2024-25')],
    })
    expect(filtered.candidates.map((item) => item.externalKey)).toEqual(['a|2025|NBA'])
  })

  it('passSeasonIncluded respects excluded sport + season keys', () => {
    expect(passSeasonIncluded({ sport: 'NBA', seasonLabel: '2024-25', seasonYear: 2024 }, ['NBA|2023-24'])).toBe(true)
    expect(passSeasonIncluded({ sport: 'NBA', seasonLabel: '2024-25', seasonYear: 2024 }, ['NBA|2024-25'])).toBe(false)
    expect(passSeasonIncluded({ sport: 'NBA', seasonLabel: '2024-25', seasonYear: 2024 })).toBe(true)
  })

  it('defaults Rank OTD Net exclusions for unsupported early seasons', () => {
    expect(DEFAULT_RANK_EXCLUDED_SPORT_SEASONS).toEqual([
      { sport: 'NFL', seasonLabel: '2022-23' },
      { sport: 'NHL', seasonLabel: '2020-21' },
      { sport: 'NHL', seasonLabel: '2021-22' },
      { sport: 'NHL', seasonLabel: '2022-23' },
      { sport: 'CBB', seasonLabel: '2022-23' },
    ])
    expect(defaultRankExcludedSportSeasonKeys()).toEqual([
      'NFL|2022-23',
      'NHL|2020-21',
      'NHL|2021-22',
      'NHL|2022-23',
      'CBB|2022-23',
    ])
    expect(sportSeasonFilterKey('NFL', '2022-23')).toBe('NFL|2022-23')
    expect(
      passSeasonIncluded(
        { sport: 'NFL', seasonLabel: '2022-23', seasonYear: 2022 },
        defaultRankExcludedSportSeasonKeys(),
      ),
    ).toBe(false)
    expect(
      passSeasonIncluded(
        { sport: 'NHL', seasonLabel: '2022-23', seasonYear: 2022 },
        defaultRankExcludedSportSeasonKeys(),
      ),
    ).toBe(false)
    expect(
      passSeasonIncluded(
        { sport: 'CBB', seasonLabel: '2022-23', seasonYear: 2023 },
        defaultRankExcludedSportSeasonKeys(),
      ),
    ).toBe(false)
    expect(
      passSeasonIncluded(
        { sport: 'NFL', seasonLabel: '2023-24', seasonYear: 2023 },
        defaultRankExcludedSportSeasonKeys(),
      ),
    ).toBe(true)
  })

  it('filterRankCatalogSports drops UFC only when Include UFC is off', () => {
    const sports = ['NBA', 'UFC', 'FC'] as const
    expect(filterRankCatalogSports(sports)).toEqual(['NBA', 'UFC', 'FC'])
    expect(filterRankCatalogSports(sports, true)).toEqual(['NBA', 'UFC', 'FC'])
    expect(filterRankCatalogSports(sports, false)).toEqual(['NBA', 'FC'])
    expect(filterRankCatalogSports(['UFC'], false)).toEqual([])
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
      excludedSportSeasonKeys: [sportSeasonFilterKey('NFL', '2024-25')],
    })
    expect(filtered.candidates.map((item) => item.externalKey)).toEqual(['current|2025|NFL'])
  })

  it('excludes one sport+season without hiding the same label in another sport', () => {
    const nflPrior = {
      ...catalogProfile('nfl|2025|NFL', 'NFL prior', [{ claimDay: '2026-03-01', baseRaxEarned: 8 }]),
      sport: 'NFL',
      seasonYear: 2025,
      seasonLabel: '2022-23',
    }
    const nbaSameLabel = {
      ...catalogProfile('nba|2025|NBA', 'NBA same label', [{ claimDay: '2026-03-01', baseRaxEarned: 12 }]),
      sport: 'NBA',
      seasonYear: 2025,
      seasonLabel: '2022-23',
    }

    const filtered = filterRecommendationProfiles(data, [nflPrior, nbaSameLabel], {
      excludedSportSeasonKeys: [sportSeasonFilterKey('NFL', '2022-23')],
    })
    expect(filtered.candidates.map((item) => item.externalKey)).toEqual(['nba|2025|NBA'])
  })

  it('filters FC passes by season label when multiple labels share a year', () => {
    const current = {
      ...catalogProfile('current|2026|FC', 'Current', [{ claimDay: '2026-03-01', baseRaxEarned: 10 }]),
      sport: 'FC',
      seasonYear: 2026,
      seasonLabel: '2025-26',
    }
    const prior = {
      ...catalogProfile('prior|2026|FC', 'Prior', [{ claimDay: '2026-03-01', baseRaxEarned: 8 }]),
      sport: 'FC',
      seasonYear: 2026,
      seasonLabel: '2024-25',
    }

    const filtered = filterRecommendationProfiles(data, [current, prior], {
      excludedSportSeasonKeys: [sportSeasonFilterKey('FC', '2024-25')],
    })
    expect(filtered.candidates.map((item) => item.externalKey)).toEqual(['current|2026|FC'])
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

  it('ignores catalog rarity_label and always scores at Iconic 1 (solo/rank parity)', () => {
    // Shop/Meowbot leftovers: high-base fighter labeled General, lower-base labeled Iconic 1.
    const silvaLike = {
      ...catalogProfile('235|2023|UFC', 'Anderson Silva', [
        { claimDay: '2023-06-01', baseRaxEarned: 100 },
      ]),
      sport: 'UFC',
      seasonYear: 2023,
      seasonLabel: '2023',
      passKind: 'team' as const,
      rarityLabel: 'General',
    }
    const belfortLike = {
      ...catalogProfile('295|2023|UFC', 'Vitor Belfort', [
        { claimDay: '2023-06-01', baseRaxEarned: 60 },
      ]),
      sport: 'UFC',
      seasonYear: 2023,
      seasonLabel: '2023',
      passKind: 'team' as const,
      rarityLabel: 'Iconic 1',
    }

    const emptyUfc: RaxTrackerData = {
      ...data,
      cards: [],
      performances: [],
    }

    const ranked = rankCatalogRecommendations(emptyUfc, [silvaLike, belfortLike])
    expect(ranked.rows[0]?.name).toBe('Anderson Silva')
    expect(ranked.rows[0]?.rarityLabel).toBe(RECOMMENDATION_SIMULATED_RARITY)
    expect(ranked.rows[1]?.name).toBe('Vitor Belfort')
    expect(ranked.rows[0]?.netClaimableDelta).toBeGreaterThan(ranked.rows[1]?.netClaimableDelta ?? 0)

    const solo = analyzePotentialCard(
      emptyUfc,
      {
        name: silvaLike.name,
        sport: 'UFC',
        season: silvaLike.seasonLabel,
        simulatedRarityLabel: RECOMMENDATION_SIMULATED_RARITY,
        passKind: 'player',
      },
      [{ claimDay: '2023-06-01', raxEarned: 100, baseRaxEarned: 100, note: '' }],
    )
    const rankedSilva = analyzeCatalogCandidate(emptyUfc, silvaLike)
    expect(solo).not.toBeNull()
    expect(rankedSilva).not.toBeNull()
    expect(rankedSilva!.netClaimableDelta).toBe(netClaimableDelta(solo!))
  })

  it('keeps unowned and below-Iconic owned passes; only Iconic 1+ owned are skipped', () => {
    const profiles = [
      catalogProfile('unowned|2025|NBA', 'Unowned', [
        { claimDay: '2026-03-01', baseRaxEarned: 40 },
      ]),
      {
        ...catalogProfile('null-rarity|2025|NBA', 'Null rarity catalog', [
          { claimDay: '2026-03-01', baseRaxEarned: 30 },
        ]),
        rarityLabel: undefined,
      },
      catalogProfile('owned-common|2025|NBA', 'Owned common', [
        { claimDay: '2026-03-01', baseRaxEarned: 25 },
      ]),
      catalogProfile('owned-iconic|2025|NBA', 'Owned iconic', [
        { claimDay: '2026-03-01', baseRaxEarned: 50 },
      ]),
    ]
    const ownedData: RaxTrackerData = {
      ...data,
      cards: [
        ...data.cards,
        card('owned-common', 'Owned common', 'owned-common|2025|NBA', 'Common'),
        card('owned-iconic', 'Owned iconic', 'owned-iconic|2025|NBA', 'Iconic 2'),
      ],
    }

    expect(shouldSkipRecommendationPass(ownedData, profiles[0]!)).toBe(false)
    expect(shouldSkipRecommendationPass(ownedData, profiles[1]!)).toBe(false)
    expect(shouldSkipRecommendationPass(ownedData, profiles[2]!)).toBe(false)
    expect(shouldSkipRecommendationPass(ownedData, profiles[3]!)).toBe(true)

    const filtered = filterRecommendationProfiles(ownedData, profiles)
    expect(filtered.skippedOwnedIconic).toBe(1)
    expect(filtered.candidates.map((item) => item.externalKey).sort()).toEqual([
      'null-rarity|2025|NBA',
      'owned-common|2025|NBA',
      'unowned|2025|NBA',
    ])

    const selected = selectSummariesForBulkFetch(
      ownedData,
      profiles.map((profile) => summary(profile.externalKey, profile.name, profile.totalBaseRax)),
    )
    expect(selected.skippedOwnedIconic).toBe(1)
    expect(selected.keys.sort()).toEqual([
      'null-rarity|2025|NBA',
      'owned-common|2025|NBA',
      'unowned|2025|NBA',
    ])
  })

  it('ranks candidates by net gain in a specific month', () => {
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

    const marchStar = catalogProfile('march|2025|NBA', 'March star', [
      { claimDay: '2026-03-01', baseRaxEarned: 50 },
    ])
    const aprilStar = catalogProfile('april|2025|NBA', 'April star', [
      { claimDay: '2026-04-15', baseRaxEarned: 50 },
    ])

    const marchRanked = rankCatalogRecommendationsForMonth(spreadData, [marchStar, aprilStar], 2)
    expect(marchRanked.rows[0]?.name).toBe('March star')
    expect(marchRanked.rows[0]?.monthNetDelta).toBeGreaterThan(
      marchRanked.rows[1]?.monthNetDelta ?? 0,
    )

    const aprilRanked = rankCatalogRecommendationsForMonth(spreadData, [marchStar, aprilStar], 3)
    expect(aprilRanked.rows[0]?.name).toBe('April star')
    expect(aprilRanked.rows[0]?.monthNetDelta).toBeGreaterThan(
      aprilRanked.rows[1]?.monthNetDelta ?? 0,
    )
  })

  it('ranks candidates by net gain on a specific claim day', () => {
    const spreadData: RaxTrackerData = {
      ...data,
      performances: [
        perf('p1', 'c1', 30, '2026-03-01'),
        perf('p2', 'c2', 25, '2026-03-01'),
        perf('p3', 'c3', 10, '2026-03-15'),
        perf('p4', 'c1', 40, '2026-03-15'),
        perf('p5', 'c2', 35, '2026-03-15'),
      ],
    }

    const earlyStar = catalogProfile('early|2025|NBA', 'Early star', [
      { claimDay: '2026-03-01', baseRaxEarned: 50 },
    ])
    const midStar = catalogProfile('mid|2025|NBA', 'Mid star', [
      { claimDay: '2026-03-15', baseRaxEarned: 50 },
    ])

    const earlyRanked = rankCatalogRecommendationsForDay(spreadData, [earlyStar, midStar], '2026-03-01')
    expect(earlyRanked.claimDay).toBe('03-01')
    expect(earlyRanked.rows).toHaveLength(1)
    expect(earlyRanked.rows[0]?.name).toBe('Early star')
    expect(earlyRanked.rows[0]?.monthNetDelta).toBeGreaterThan(0)

    const midRanked = rankCatalogRecommendationsForDay(spreadData, [earlyStar, midStar], '03-15')
    expect(midRanked.claimDay).toBe('03-15')
    expect(midRanked.rows).toHaveLength(1)
    expect(midRanked.rows[0]?.name).toBe('Mid star')
  })

  it('normalizes best-day query params and keeps top N per sport', () => {
    expect(normalizeBestDayParam('2026-03-15')).toBe('03-15')
    expect(normalizeBestDayParam('03-15')).toBe('03-15')
    expect(normalizeBestDayParam('bad')).toBeNull()

    const rows = [
      { sport: 'NBA' as const, name: 'a', monthNetDelta: 30 },
      { sport: 'NBA' as const, name: 'b', monthNetDelta: 20 },
      { sport: 'NBA' as const, name: 'c', monthNetDelta: 10 },
      { sport: 'NFL' as const, name: 'd', monthNetDelta: 40 },
      { sport: 'UFC' as const, name: 'e', monthNetDelta: 15 },
      { sport: 'UFC' as const, name: 'f', monthNetDelta: 12 },
      { sport: 'UFC' as const, name: 'g', monthNetDelta: 5 },
    ]
    expect(topRecommendationRowsPerSport(rows, 2).map((row) => row.name)).toEqual([
      'a',
      'b',
      'd',
      'e',
      'f',
    ])
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

  it('dedupes duplicate catalog identities and skips owned iconic players once', () => {
    const ownedData: RaxTrackerData = {
      ...data,
      cards: [
        ...data.cards,
        {
          ...card('cbb-owned', 'Maxime Raynaud', '999|2025|CBB', 'Iconic 1'),
          sport: 'CBB',
          season: '2024-25',
        },
      ],
    }

    const duplicateProfiles = [
      {
        ...catalogProfile('111|2025|CBB', 'Maxime Raynaud', [{ claimDay: '2026-03-01', baseRaxEarned: 40 }]),
        sport: 'CBB',
        seasonLabel: '2024-25',
        totalBaseRax: 300,
      },
      {
        ...catalogProfile('222|2025|CBB', 'Maxime Raynaud', [{ claimDay: '2026-03-01', baseRaxEarned: 40 }]),
        sport: 'CBB',
        seasonLabel: '2024-25',
        totalBaseRax: 343,
      },
      catalogProfile('other|2025|CBB', 'Other player', [{ claimDay: '2026-03-01', baseRaxEarned: 20 }]),
    ].map((profile) => ({ ...profile, sport: 'CBB' }))

    const filtered = filterRecommendationProfiles(ownedData, duplicateProfiles)
    expect(filtered.candidates).toHaveLength(1)
    expect(filtered.candidates[0]?.name).toBe('Other player')
    expect(filtered.skippedOwnedIconic).toBe(1)
  })

  it('analyzeCatalogCandidate returns null for profiles without rows', () => {
    expect(
      analyzeCatalogCandidate(data, catalogProfile('empty|2025|NBA', 'Empty', [])),
    ).toBeNull()
  })

  it('analyzeCatalogCandidate carries catalog avatar onto ranking rows', () => {
    const profile = {
      ...catalogProfile('face|2025|NBA', 'Face Pass', [
        { claimDay: '2026-03-01', baseRaxEarned: 40 },
      ]),
      avatar: 'abc123facehash',
    }
    const row = analyzeCatalogCandidate(data, profile)
    expect(row).not.toBeNull()
    expect(row!.avatar).toBe('abc123facehash')
  })

  it('recommendationAdjustmentFromPass copies avatar and passKind', () => {
    const adjustment = recommendationAdjustmentFromPass(
      {
        externalKey: 'face|2025|NBA',
        name: 'Face Pass',
        sport: 'NBA',
        seasonLabel: '2025-26',
        passKind: 'player',
        avatar: 'adj-face',
      },
      'assume-iconic-1',
    )
    expect(adjustment.avatar).toBe('adj-face')
    expect(adjustment.passKind).toBe('player')
    expect(adjustment.mode).toBe('assume-iconic-1')
  })

  it('month and day ranking rows carry catalog avatar', () => {
    const profile = {
      ...catalogProfile('face|2025|NBA', 'Face Pass', [
        { claimDay: '2026-03-01', baseRaxEarned: 40 },
      ]),
      avatar: 'month-day-face',
    }
    const month = rankCatalogRecommendationsForMonth(data, [profile], 2)
    const day = rankCatalogRecommendationsForDay(data, [profile], '03-01')
    expect(month.rows[0]?.avatar).toBe('month-day-face')
    expect(day.rows[0]?.avatar).toBe('month-day-face')
  })

  it('analyzeCatalogCandidate reports overlap RAX when the new pass loses claim days', () => {
    // Two guaranteed + one pro-bonus slot; a 4th weak pass is pure overlap.
    const stacked: RaxTrackerData = {
      version: 1,
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [
        card('a', 'Star A', 'a|2025|NBA', 'Iconic 1'),
        card('b', 'Star B', 'b|2025|NBA', 'Iconic 1'),
        card('c', 'Star C', 'c|2025|NBA', 'Iconic 1'),
      ],
      performances: [
        perf('pa', 'a', 500, '2026-03-01'),
        perf('pb', 'b', 400, '2026-03-01'),
        perf('pc', 'c', 300, '2026-03-01'),
      ],
      potentialCards: [],
      savedCardProfiles: [],
    }
    const overlapped = analyzeCatalogCandidate(
      stacked,
      catalogProfile('low|2025|NBA', 'Low overlap pass', [
        { claimDay: '2026-03-01', baseRaxEarned: 1 },
      ]),
    )
    expect(overlapped).not.toBeNull()
    expect(overlapped!.newClaimableRax).toBe(0)
    expect(overlapped!.overlapRax).toBeGreaterThan(0)
    expect(overlapped!.netClaimableDelta).toBe(0)

    const check = analyzePotentialCard(
      stacked,
      {
        name: 'Low overlap pass',
        sport: 'NBA',
        season: '2025-26',
        simulatedRarityLabel: RECOMMENDATION_SIMULATED_RARITY,
        passKind: 'player',
      },
      [{ claimDay: '2026-03-01', raxEarned: 1, baseRaxEarned: 1, note: '' }],
    )
    expect(check?.overlapRax).toBe(overlapped!.overlapRax)
  })

  it('applyRecommendationBaseline upgrades an owned lower-tier pass to Iconic 1', () => {
    const profile = catalogProfile('owned-leg|2025|NBA', 'Owned legendary', [
      { claimDay: '2026-03-01', baseRaxEarned: 20 },
    ])
    const ownedData: RaxTrackerData = {
      ...data,
      cards: [...data.cards, card('owned-leg', 'Owned legendary', 'owned-leg|2025|NBA', 'Legendary 1')],
      performances: [...data.performances, perf('p-owned', 'owned-leg', 20, '2026-03-01')],
    }

    const baseline = applyRecommendationBaseline(
      ownedData,
      new Map([[profile.externalKey, profile]]),
      [
        {
          externalKey: profile.externalKey,
          name: profile.name,
          sport: 'NBA',
          season: '2025-26',
          mode: 'assume-iconic-1',
        },
      ],
    )

    const upgraded = baseline.cards.find((item) => item.externalKey === profile.externalKey)
    expect(upgraded?.rarityLabel).toBe(RECOMMENDATION_SIMULATED_RARITY)
    expect(upgraded?.id).toBe('owned-leg')
    expect(
      baseline.performances.find((item) => item.cardId === 'owned-leg')?.raxEarned,
    ).toBeGreaterThan(20)
  })

  it('applyRecommendationBaseline omits Rare/Epic player passes from the collection', () => {
    const ownedData: RaxTrackerData = {
      ...data,
      cards: [
        ...data.cards,
        card('owned-leg', 'Owned legendary', 'owned-leg|2025|NBA', 'Legendary 1'),
        card('owned-rare', 'Owned rare', 'owned-rare|2025|NBA', 'Rare 1'),
        card('owned-epic', 'Owned epic', 'owned-epic|2025|NBA', 'Epic 2'),
      ],
      performances: [
        ...data.performances,
        perf('p-leg', 'owned-leg', 20, '2026-03-01'),
        perf('p-rare', 'owned-rare', 10, '2026-03-02'),
        perf('p-epic', 'owned-epic', 12, '2026-03-03'),
      ],
    }

    const baseline = applyRecommendationBaseline(ownedData, new Map(), [])
    expect(baseline.cards.map((item) => item.id)).toContain('owned-leg')
    expect(baseline.cards.map((item) => item.id)).not.toContain('owned-rare')
    expect(baseline.cards.map((item) => item.id)).not.toContain('owned-epic')
    expect(baseline.performances.map((item) => item.id)).toContain('p-leg')
    expect(baseline.performances.map((item) => item.id)).not.toContain('p-rare')
    expect(baseline.performances.map((item) => item.id)).not.toContain('p-epic')
  })

  it('excludes adjusted passes from recommendation candidates', () => {
    const profiles = [
      catalogProfile('target|2025|NBA', 'Target', [{ claimDay: '2026-03-01', baseRaxEarned: 40 }]),
      catalogProfile('skip|2025|NBA', 'Skip me', [{ claimDay: '2026-03-01', baseRaxEarned: 30 }]),
    ]

    const filtered = filterRecommendationProfiles(data, profiles, {
      adjustments: [
        {
          externalKey: 'skip|2025|NBA',
          name: 'Skip me',
          sport: 'NBA',
          season: '2025-26',
          mode: 'exclude',
        },
      ],
    })

    expect(filtered.skippedAdjusted).toBe(1)
    expect(filtered.candidates.map((item) => item.externalKey)).toEqual(['target|2025|NBA'])
  })

  it('assumed Iconic 1 passes are skipped and change ranking baseline', () => {
    const ownedProfile = catalogProfile('owned-leg|2025|NBA', 'Owned legendary', [
      { claimDay: '2026-03-01', baseRaxEarned: 20 },
    ])
    const candidate = catalogProfile('new|2025|NBA', 'New pass', [
      { claimDay: '2026-03-01', baseRaxEarned: 18 },
    ])
    const ownedData: RaxTrackerData = {
      ...data,
      cards: [...data.cards, card('owned-leg', 'Owned legendary', 'owned-leg|2025|NBA', 'Legendary 1')],
      performances: [...data.performances, perf('p-owned', 'owned-leg', 20, '2026-03-01')],
    }
    const profilesByKey = new Map([
      [ownedProfile.externalKey, ownedProfile],
      [candidate.externalKey, candidate],
    ])
    const adjustments = [
      {
        externalKey: ownedProfile.externalKey,
        name: ownedProfile.name,
        sport: 'NBA' as const,
        season: '2025-26',
        mode: 'assume-iconic-1' as const,
      },
    ]

    const baseline = applyRecommendationBaseline(ownedData, profilesByKey, adjustments)
    const withoutBaseline = analyzeCatalogCandidate(ownedData, candidate)
    const withBaseline = analyzeCatalogCandidate(baseline, candidate)

    expect(shouldSkipRecommendationPass(ownedData, ownedProfile, adjustments)).toBe(true)
    expect(withoutBaseline?.netClaimableDelta).not.toBe(withBaseline?.netClaimableDelta)
  })

  it('matches rank adjustments to duplicate catalog passes by player identity', () => {
    const duplicateA = catalogProfile('846|2024|NFL', 'CeeDee Lamb', [
      { claimDay: '2024-01-07', baseRaxEarned: 100 },
    ])
    const duplicateB = catalogProfile('999|2024|NFL', 'CeeDee Lamb', [
      { claimDay: '2024-01-07', baseRaxEarned: 120 },
    ])
    for (const profile of [duplicateA, duplicateB]) {
      profile.sport = 'NFL'
      profile.seasonYear = 2024
      profile.seasonLabel = '2023-24'
    }

    const adjustments = [
      {
        externalKey: duplicateA.externalKey,
        name: duplicateA.name,
        sport: 'NFL' as const,
        season: '2023-24',
        mode: 'assume-iconic-1' as const,
      },
    ]

    expect(isPassInRecommendationAdjustments(duplicateB, adjustments)).toBe(true)
    expect(shouldSkipRecommendationPass(data, duplicateB, adjustments)).toBe(true)

    const profilesByKey = new Map([
      [duplicateA.externalKey, duplicateA],
      [duplicateB.externalKey, duplicateB],
    ])
    const resolved = resolveProfileForRecommendationAdjustment(adjustments[0]!, profilesByKey)
    expect(resolved?.externalKey).toBe(duplicateA.externalKey)

    const filtered = filterRecommendationProfiles(data, [duplicateA, duplicateB], { adjustments })
    expect(filtered.skippedAdjusted).toBe(1)
    expect(filtered.candidates).toHaveLength(0)
  })

  it('accounts for same-sport owned Iconic upgrades when scoring quick-add impact', () => {
    const upgradeData: RaxTrackerData = {
      version: 1,
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [
        { ...card('c-low', 'Bench A', '100|2026|NBA', 'Legendary 1'), avatar: 'bench-face' },
        { ...card('c-high', 'Star B', '101|2026|NBA', 'Legendary 1'), avatar: 'star-face' },
      ],
      performances: [
        { ...perf('p1', 'c-low', 20, '2026-03-01'), baseRaxEarned: 1 },
        { ...perf('p2', 'c-high', 30, '2026-03-01'), baseRaxEarned: 1.5 },
      ],
      potentialCards: [],
      savedCardProfiles: [],
    }

    const candidates = [
      ownedCardToIconicUpgradeCandidate(upgradeData.cards[1]!),
      ownedCardToIconicUpgradeCandidate(upgradeData.cards[0]!),
    ].filter((item): item is NonNullable<typeof item> => item !== null)

    const impacts = analyzeOwnedIconicUpgradeImpacts(upgradeData, candidates)
    expect(impacts.rows).toHaveLength(2)
    expect(impacts.combinedNetDelta).toBeGreaterThan(0)
    expect(impacts.combinedIsolatedNetDelta).toBeGreaterThanOrEqual(impacts.combinedNetDelta)

    const highImpact = impacts.rows.find((row) => row.key === '101|2026|NBA')
    const lowImpact = impacts.rows.find((row) => row.key === '100|2026|NBA')
    expect(highImpact?.marginalNetDelta).toBeGreaterThan(0)
    expect(highImpact?.passClaimableRax).toBeGreaterThan(0)
    expect(highImpact?.avatar).toBe('star-face')
    expect(highImpact?.passKind).toBe('player')
    expect(lowImpact?.avatar).toBe('bench-face')
    expect(lowImpact?.marginalNetDelta).toBeLessThanOrEqual(lowImpact?.isolatedNetDelta ?? 0)
    // Per-pass contribution list: highest net RAX first.
    expect(impacts.rows.map((row) => row.key)).toEqual(
      [...impacts.rows]
        .sort((a, b) => b.marginalNetDelta - a.marginalNetDelta)
        .map((row) => row.key),
    )
  })

  it('isIconicBelowLevel identifies sub-20 Iconic passes', () => {
    expect(isIconicBelowLevel('Iconic 1', 20)).toBe(true)
    expect(isIconicBelowLevel('Iconic 19', 20)).toBe(true)
    expect(isIconicBelowLevel('Iconic 20', 20)).toBe(false)
    expect(isIconicBelowLevel('Legendary 1', 20)).toBe(false)
  })

  it('analyzeIconic20CheckerImpacts upgrades owned Iconic 1 and adds catalog passes', () => {
    const ownedData: RaxTrackerData = {
      version: 1,
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [
        card('c-owned', 'Owned Iconic', '200|2026|NBA', 'Iconic 1'),
        card('c-other', 'Other', '201|2026|NBA', 'Legendary 1'),
      ],
      performances: [
        { ...perf('p1', 'c-owned', 150, '2026-03-01'), baseRaxEarned: 1 },
        { ...perf('p2', 'c-other', 25, '2026-03-01'), baseRaxEarned: 1 },
      ],
      potentialCards: [],
      savedCardProfiles: [],
    }
    const catalogPass = catalogProfile('300|2026|NBA', 'Catalog new', [
      { claimDay: '2026-03-02', baseRaxEarned: 1.2 },
    ])

    const ownedCandidate = ownedCardToIconic20CheckerCandidate(ownedData.cards[0]!)
    const catalogCandidate = catalogProfileToIconic20CheckerCandidate(catalogPass)
    expect(ownedCandidate?.source).toBe('owned')
    expect(catalogCandidate?.source).toBe('catalog')

    const impacts = analyzeIconic20CheckerImpacts(ownedData, [
      ownedCandidate!,
      catalogCandidate!,
    ])
    expect(impacts.rows).toHaveLength(2)
    expect(impacts.combinedNetDelta).toBeGreaterThan(0)
    expect(impacts.rows.every((row) => row.isolatedNetDelta >= 0)).toBe(true)
  })
})

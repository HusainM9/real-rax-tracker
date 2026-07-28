import { describe, expect, it } from 'vitest'
import type { CatalogImportProfile } from './catalogApi'
import {
  analyzePlanCollection,
  applyPackEtaToPlannedPasses,
  buildPlanFinishedCollection,
  plannedPassFromOwnedCard,
  plannedPassSimulatedTotalRax,
  planProgressFromPackDaysRemaining,
  rankPlanFinishedForSales,
} from './plannedPasses'
import { DEFAULT_PACK_RATING_INCREMENT } from './packTracker'
import { withoutCards } from './removeCardAnalysis'
import {
  analyzeCatalogBundleImpacts,
  analyzeCatalogBundleImpactsAtProfileRarities,
  analyzeCatalogImportAtRarity,
  applyCatalogProfilesAtOwnRarities,
  profileAtSimulatedRarity,
  RECOMMENDATION_SIMULATED_RARITY,
} from './passRecommendation'
import type { PackTracker, PlannedPass, PlayerCard, RaxPerformance, RaxTrackerData } from '../types/rax'

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
    passKind: 'player',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function perf(id: string, cardId: string, rax: number, claimDay: string): RaxPerformance {
  return {
    id,
    cardId,
    claimDay,
    raxEarned: rax,
    baseRaxEarned: rax,
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

function plannedPass(
  partial: Pick<PlannedPass, 'id' | 'externalKey' | 'name' | 'simulatedRarityLabel'> &
    Partial<PlannedPass>,
): PlannedPass {
  return {
    sport: 'NBA',
    season: '2025-26',
    passKind: 'player',
    totalBaseRax: 1,
    rowCount: 1,
    notes: '',
    source: 'catalog',
    progress: 'just-started',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

describe('plannedPasses', () => {
  it('plannedPassFromOwnedCard builds a manual plan entry', () => {
    const owned = card('c1', 'Owned', '10|2025|NBA', 'Legendary 1')
    const input = plannedPassFromOwnedCard(owned, {
      simulatedRarityLabel: 'Iconic 1',
      totalBaseRax: 12,
      rowCount: 3,
    })
    expect(input).toEqual({
      externalKey: '10|2025|NBA',
      name: 'Owned',
      sport: 'NBA',
      season: '2025-26',
      passKind: 'player',
      simulatedRarityLabel: 'Iconic 1',
      totalBaseRax: 12,
      rowCount: 3,
      notes: '',
      source: 'manual',
      progress: 'just-started',
    })
    expect(plannedPassFromOwnedCard(card('c2', 'No key', undefined, 'Rare 1'))).toBeNull()
  })

  it('analyzePlanCollection scores each pass at its planned rarity in the bundle', () => {
    const data: RaxTrackerData = {
      version: 1,
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [card('c-other', 'Other', '99|2025|NBA', 'Legendary 1')],
      performances: [perf('p-other', 'c-other', 5, '2026-03-01')],
      potentialCards: [],
      savedCardProfiles: [],
      plannedPasses: [],
    }

    const legendaryProfile = catalogProfile('1|2025|NBA', 'Pass Legendary', [
      { claimDay: '2026-03-02', baseRaxEarned: 1 },
    ])
    const iconicProfile = catalogProfile('2|2025|NBA', 'Pass Iconic', [
      { claimDay: '2026-03-03', baseRaxEarned: 1 },
    ])

    const passes = [
      plannedPass({
        id: 'plan-1',
        externalKey: '1|2025|NBA',
        name: 'Pass Legendary',
        simulatedRarityLabel: 'Legendary 1',
      }),
      plannedPass({
        id: 'plan-2',
        externalKey: '2|2025|NBA',
        name: 'Pass Iconic',
        simulatedRarityLabel: RECOMMENDATION_SIMULATED_RARITY,
      }),
    ]

    const profilesByKey = new Map([
      [legendaryProfile.externalKey, legendaryProfile],
      [iconicProfile.externalKey, iconicProfile],
    ])

    const analysis = analyzePlanCollection(data, passes, profilesByKey)
    expect(analysis.activeProfiles).toHaveLength(2)
    expect(analysis.passes[0]?.profile?.rarityLabel).toBe('Legendary 1')
    expect(analysis.passes[1]?.profile?.rarityLabel).toBe(RECOMMENDATION_SIMULATED_RARITY)
    expect(analysis.bundle?.rows).toHaveLength(2)

    const mixed = analyzeCatalogBundleImpactsAtProfileRarities(data, [
      profileAtSimulatedRarity(legendaryProfile, 'Legendary 1'),
      profileAtSimulatedRarity(iconicProfile, RECOMMENDATION_SIMULATED_RARITY),
    ])
    const forcedIconic = analyzeCatalogBundleImpacts(data, [
      profileAtSimulatedRarity(legendaryProfile, 'Legendary 1'),
      profileAtSimulatedRarity(iconicProfile, RECOMMENDATION_SIMULATED_RARITY),
    ], RECOMMENDATION_SIMULATED_RARITY)

    // Mixed rarities should not match forcing every pass to Iconic 1.
    expect(mixed.combinedNetDelta).not.toBe(forcedIconic.combinedNetDelta)
    expect(analysis.combinedNetDelta).toBe(mixed.combinedNetDelta)
    expect(analysis.withPlanClaimable).toBeGreaterThan(analysis.currentClaimable)
  })

  it('treats owned non-iconic plan adds as upgrades', () => {
    const owned = card('c-owned', 'Owned Star', '50|2025|NBA', 'Legendary 1')
    const data: RaxTrackerData = {
      version: 1,
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [owned],
      performances: [{ ...perf('p1', 'c-owned', 20, '2026-03-01'), baseRaxEarned: 1 }],
      potentialCards: [],
      savedCardProfiles: [],
      plannedPasses: [],
    }
    const profile = catalogProfile('50|2025|NBA', 'Owned Star', [
      { claimDay: '2026-03-01', baseRaxEarned: 1 },
    ])
    const passes = [
      plannedPass({
        id: 'plan-owned',
        externalKey: '50|2025|NBA',
        name: 'Owned Star',
        simulatedRarityLabel: RECOMMENDATION_SIMULATED_RARITY,
        source: 'manual',
      }),
    ]

    const analysis = analyzePlanCollection(
      data,
      passes,
      new Map([[profile.externalKey, profile]]),
    )
    expect(analysis.passes[0]?.ownedBelowIconic).toBe(true)
    expect(analysis.passes[0]?.missingRows).toBe(false)
    expect(analysis.combinedNetDelta).toBeGreaterThan(0)
    expect(analysis.activeProfiles).toHaveLength(1)
    expect(
      plannedPassSimulatedTotalRax(passes[0]!, profileAtSimulatedRarity(profile, RECOMMENDATION_SIMULATED_RARITY)),
    ).toBeGreaterThan(0)
  })

  it('plan net gain: leave-one-out matches Rank/Check one against the rest of the plan', () => {
    const data: RaxTrackerData = {
      version: 1,
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [card('c-other', 'Other', '99|2025|NBA', 'Legendary 1')],
      performances: [perf('p-other', 'c-other', 50, '2026-03-01')],
      potentialCards: [],
      savedCardProfiles: [],
      plannedPasses: [],
    }

    // Four NBA earners on one day → contested slots even with Pro (top 2 + 1 Pro).
    const passA = catalogProfile('1|2025|NBA', 'Pass A', [
      { claimDay: '2026-03-01', baseRaxEarned: 3 },
    ])
    const passB = catalogProfile('2|2025|NBA', 'Pass B', [
      { claimDay: '2026-03-01', baseRaxEarned: 2.5 },
    ])
    const passC = catalogProfile('3|2025|NBA', 'Pass C', [
      { claimDay: '2026-03-01', baseRaxEarned: 2 },
    ])
    const passes = [
      plannedPass({
        id: 'plan-1',
        externalKey: '1|2025|NBA',
        name: 'Pass A',
        simulatedRarityLabel: RECOMMENDATION_SIMULATED_RARITY,
      }),
      plannedPass({
        id: 'plan-2',
        externalKey: '2|2025|NBA',
        name: 'Pass B',
        simulatedRarityLabel: RECOMMENDATION_SIMULATED_RARITY,
      }),
      plannedPass({
        id: 'plan-3',
        externalKey: '3|2025|NBA',
        name: 'Pass C',
        simulatedRarityLabel: RECOMMENDATION_SIMULATED_RARITY,
      }),
    ]

    const profilesByKey = new Map([
      [passA.externalKey, passA],
      [passB.externalKey, passB],
      [passC.externalKey, passC],
    ])

    const analysis = analyzePlanCollection(data, passes, profilesByKey)
    expect(analysis.bundle).not.toBeNull()
    expect(analysis.withPlanClaimable - analysis.currentClaimable).toBe(analysis.combinedNetDelta)

    // Leave-one-out for Pass C === scoring C alone against collection + A + B.
    const withAb = applyCatalogProfilesAtOwnRarities(
      {
        ...data,
        settings: { ...data.settings, proBonusEnabled: true },
      },
      [
        profileAtSimulatedRarity(passA, RECOMMENDATION_SIMULATED_RARITY),
        profileAtSimulatedRarity(passB, RECOMMENDATION_SIMULATED_RARITY),
      ],
    )
    const soloVsRest = analyzeCatalogImportAtRarity(
      withAb,
      passC,
      RECOMMENDATION_SIMULATED_RARITY,
    )
    const planRowC = analysis.bundle!.rows.find((row) => row.key.includes('3|2025|NBA'))
    expect(planRowC?.marginalNetDelta).toBe(soloVsRest?.netClaimableDelta)
  })

  it('skips owned Iconic 1+ passes from the active bundle', () => {
    const owned = card('c-iconic', 'Already Iconic', '60|2025|NBA', 'Iconic 1')
    const data: RaxTrackerData = {
      version: 1,
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [owned],
      performances: [{ ...perf('p1', 'c-iconic', 100, '2026-03-01'), baseRaxEarned: 1 }],
      potentialCards: [],
      savedCardProfiles: [],
      plannedPasses: [],
    }
    const profile = catalogProfile('60|2025|NBA', 'Already Iconic', [
      { claimDay: '2026-03-01', baseRaxEarned: 1 },
    ])
    const analysis = analyzePlanCollection(
      data,
      [
        plannedPass({
          id: 'plan-iconic',
          externalKey: '60|2025|NBA',
          name: 'Already Iconic',
          simulatedRarityLabel: RECOMMENDATION_SIMULATED_RARITY,
        }),
      ],
      new Map([[profile.externalKey, profile]]),
    )
    expect(analysis.passes[0]?.ownedAtIconic).toBe(true)
    expect(analysis.activeProfiles).toHaveLength(0)
    expect(analysis.bundle).toBeNull()
  })

  it('scores plan nets against an if-sold collection baseline', () => {
    const owned = card('c-owned', 'Owned Star', '50|2025|NBA', 'Legendary 1')
    const data: RaxTrackerData = {
      version: 1,
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [owned],
      performances: [{ ...perf('p1', 'c-owned', 20, '2026-03-01'), baseRaxEarned: 1 }],
      potentialCards: [],
      savedCardProfiles: [],
      plannedPasses: [],
    }
    const profile = catalogProfile('50|2025|NBA', 'Owned Star', [
      { claimDay: '2026-03-01', baseRaxEarned: 1 },
    ])
    const passes = [
      plannedPass({
        id: 'plan-owned',
        externalKey: '50|2025|NBA',
        name: 'Owned Star',
        simulatedRarityLabel: RECOMMENDATION_SIMULATED_RARITY,
        source: 'manual',
      }),
    ]
    const profilesByKey = new Map([[profile.externalKey, profile]])

    const asUpgrade = analyzePlanCollection(data, passes, profilesByKey)
    const ifSold = analyzePlanCollection(withoutCards(data, ['c-owned']), passes, profilesByKey)

    expect(asUpgrade.passes[0]?.ownedBelowIconic).toBe(true)
    expect(ifSold.passes[0]?.ownedBelowIconic).toBe(false)
    expect(ifSold.currentClaimable).toBeLessThan(asUpgrade.currentClaimable)
    expect(ifSold.combinedNetDelta).not.toBe(asUpgrade.combinedNetDelta)
    expect(ifSold.withPlanClaimable).toBeGreaterThan(ifSold.currentClaimable)
  })

  it('planned sell frees a claim slot so plan net rises for a buy', () => {
    // Three owned NBA earners fill Pro slots (top 2 + Pro). A weaker planned buy is overlap.
    // Selling the weakest owned pass frees a slot so the buy's plan net becomes positive.
    const data: RaxTrackerData = {
      version: 1,
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [
        card('c-a', 'Owned A', '10|2025|NBA', 'Legendary 1'),
        card('c-b', 'Owned B', '11|2025|NBA', 'Legendary 1'),
        card('c-c', 'Owned C', '12|2025|NBA', 'Legendary 1'),
      ],
      performances: [
        perf('p-a', 'c-a', 100, '2026-03-01'),
        perf('p-b', 'c-b', 90, '2026-03-01'),
        perf('p-c', 'c-c', 80, '2026-03-01'),
      ],
      potentialCards: [],
      savedCardProfiles: [],
      plannedPasses: [],
    }
    // base 2 at Legendary 1 stays below the 80 claimable floor → overlap until a slot opens.
    const buyProfile = catalogProfile('20|2025|NBA', 'Planned Buy', [
      { claimDay: '2026-03-01', baseRaxEarned: 2 },
    ])
    const passes = [
      plannedPass({
        id: 'plan-buy',
        externalKey: '20|2025|NBA',
        name: 'Planned Buy',
        simulatedRarityLabel: 'Legendary 1',
        totalBaseRax: 2,
        rowCount: 1,
      }),
    ]
    const profilesByKey = new Map([[buyProfile.externalKey, buyProfile]])

    const keeping = analyzePlanCollection(data, passes, profilesByKey)
    const withPlannedSell = analyzePlanCollection(
      withoutCards(data, ['c-c']),
      passes,
      profilesByKey,
    )

    expect(keeping.combinedNetDelta).toBe(0)
    expect(withPlannedSell.combinedNetDelta).toBeGreaterThan(keeping.combinedNetDelta)
    expect(withPlannedSell.combinedNetDelta).toBeGreaterThan(0)

    // Plan sold impact = with-plan claimable change (buys applied), not sell-only.
    const sellOnlyDelta = withPlannedSell.currentClaimable - keeping.currentClaimable
    const soldImpactWithPlan =
      withPlannedSell.withPlanClaimable - keeping.withPlanClaimable
    expect(sellOnlyDelta).toBeLessThan(0)
    expect(soldImpactWithPlan).toBeGreaterThan(sellOnlyDelta)
    expect(soldImpactWithPlan).toBe(
      sellOnlyDelta + (withPlannedSell.combinedNetDelta - keeping.combinedNetDelta),
    )
  })

  it('Plan if-sold options force planned buys to Iconic 1 and can assume collection Iconic 1', () => {
    const owned = card('c-owned', 'Owned Low', '10|2025|NBA', 'Legendary 1')
    const data: RaxTrackerData = {
      version: 1,
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [owned],
      performances: [perf('p1', 'c-owned', 10, '2026-03-01')],
      potentialCards: [],
      savedCardProfiles: [],
      plannedPasses: [],
    }
    const buyProfile = catalogProfile('20|2025|NBA', 'Planned Buy', [
      { claimDay: '2026-03-02', baseRaxEarned: 1 },
    ])
    const passes = [
      plannedPass({
        id: 'plan-buy',
        externalKey: '20|2025|NBA',
        name: 'Planned Buy',
        simulatedRarityLabel: 'Legendary 1',
      }),
    ]
    const profilesByKey = new Map([[buyProfile.externalKey, buyProfile]])

    const mixed = analyzePlanCollection(data, passes, profilesByKey)
    const forced = analyzePlanCollection(data, passes, profilesByKey, {
      forcePlannedRarityLabel: RECOMMENDATION_SIMULATED_RARITY,
    })
    expect(mixed.passes[0]?.profile?.rarityLabel).toBe('Legendary 1')
    expect(forced.passes[0]?.profile?.rarityLabel).toBe(RECOMMENDATION_SIMULATED_RARITY)
    expect(forced.combinedNetDelta).not.toBe(mixed.combinedNetDelta)

    const withCollection = analyzePlanCollection(data, passes, profilesByKey, {
      forcePlannedRarityLabel: RECOMMENDATION_SIMULATED_RARITY,
      assumeCollectionIconic1: true,
    })
    expect(withCollection.currentClaimable).toBeGreaterThan(forced.currentClaimable)
  })

  it('maps pack days-until-Iconic onto Plan tags (Just started stays manual)', () => {
    expect(planProgressFromPackDaysRemaining(null)).toBeNull()
    expect(planProgressFromPackDaysRemaining(0)).toBeNull()
    expect(planProgressFromPackDaysRemaining(1)).toBe('nearly-finished')
    expect(planProgressFromPackDaysRemaining(7)).toBe('nearly-finished')
    expect(planProgressFromPackDaysRemaining(8)).toBe('on-the-way')
    expect(planProgressFromPackDaysRemaining(31)).toBe('on-the-way')
    expect(planProgressFromPackDaysRemaining(32)).toBe('future')
  })

  it('applies pack ETA tags onto planned passes without writing Just started', () => {
    const nearTracker: PackTracker = {
      id: 'pack_near',
      plannedPassId: 'plan-near',
      accounts: [{ id: 'a1', name: 'Main', rating: 3320, opensPacks: true }],
      ratingPerPack: DEFAULT_PACK_RATING_INCREMENT,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }
    const farTracker: PackTracker = {
      id: 'pack_far',
      plannedPassId: 'plan-far',
      accounts: [{ id: 'a2', name: 'Main', rating: 100, opensPacks: true }],
      ratingPerPack: DEFAULT_PACK_RATING_INCREMENT,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }
    const noEtaTracker: PackTracker = {
      id: 'pack_idle',
      plannedPassId: 'plan-idle',
      accounts: [{ id: 'a3', name: 'Main', rating: 100, opensPacks: false }],
      ratingPerPack: DEFAULT_PACK_RATING_INCREMENT,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }

    const passes = [
      plannedPass({
        id: 'plan-near',
        externalKey: '1|2025|NBA',
        name: 'Near',
        simulatedRarityLabel: RECOMMENDATION_SIMULATED_RARITY,
      }),
      plannedPass({
        id: 'plan-far',
        externalKey: '2|2025|NBA',
        name: 'Far',
        simulatedRarityLabel: RECOMMENDATION_SIMULATED_RARITY,
      }),
      plannedPass({
        id: 'plan-idle',
        externalKey: '3|2025|NBA',
        name: 'Idle',
        simulatedRarityLabel: RECOMMENDATION_SIMULATED_RARITY,
        progress: 'just-started',
      }),
    ]

    const { plannedPasses: next, changed } = applyPackEtaToPlannedPasses(passes, [
      nearTracker,
      farTracker,
      noEtaTracker,
    ])
    expect(changed).toBe(true)
    expect(next.find((pass) => pass.id === 'plan-near')?.progress).toBe('nearly-finished')
    expect(next.find((pass) => pass.id === 'plan-far')?.progress).toBe('future')
    expect(next.find((pass) => pass.id === 'plan-idle')?.progress).toBe('just-started')
  })

  it('buildPlanFinishedCollection applies planned buys at Iconic 1 for post-plan sell rank', () => {
    const owned = card('c-owned', 'Keeper', '10|2025|NBA', 'Legendary 1')
    const data: RaxTrackerData = {
      version: 1,
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [owned],
      performances: [perf('p-owned', 'c-owned', 50, '2026-03-01')],
      potentialCards: [],
      savedCardProfiles: [],
      plannedPasses: [],
    }
    const buy = catalogProfile('20|2025|NBA', 'Plan Buy', [
      { claimDay: '2026-03-02', baseRaxEarned: 1 },
    ])
    const passes = [
      plannedPass({
        id: 'plan-buy',
        externalKey: '20|2025|NBA',
        name: 'Plan Buy',
        simulatedRarityLabel: 'Legendary 1',
      }),
    ]
    const profilesByKey = new Map([[buy.externalKey, buy]])

    const finished = buildPlanFinishedCollection(data, passes, profilesByKey)
    expect(finished.data.cards.length).toBeGreaterThan(data.cards.length)
    const plannedCard = finished.data.cards.find((item) => item.externalKey === '20|2025|NBA')
    expect(plannedCard?.rarityLabel).toBe(RECOMMENDATION_SIMULATED_RARITY)
    expect(finished.sourceByCardId.get(plannedCard!.id)).toBe('planned')
    expect(finished.sourceByCardId.get('c-owned')).toBe('owned')

    const ranked = rankPlanFinishedForSales(data, passes, profilesByKey)
    expect(ranked.rankings.length).toBeGreaterThanOrEqual(2)
    expect(ranked.rankings.some((row) => row.source === 'planned')).toBe(true)
    expect(ranked.rankings.some((row) => row.source === 'owned')).toBe(true)
  })
})

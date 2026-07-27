import { describe, expect, it } from 'vitest'
import { analyzePotentialCard, netWithProDelta } from './potentialAnalysis'
import {
  analyzeCatalogCandidate,
  analyzeCatalogImportAtRarity,
  applyCatalogProfilesAtOwnRarities,
  profileAtSimulatedRarity,
  RECOMMENDATION_SIMULATED_RARITY,
} from './passRecommendation'
import { analyzePlanCollection } from './plannedPasses'
import type { CatalogImportProfile } from './catalogApi'
import type { PlannedPass, PlayerCard, RaxPerformance, RaxTrackerData } from '../types/rax'

function card(
  id: string,
  name: string,
  sport: PlayerCard['sport'],
  externalKey: string,
  rarity = 'Iconic 1',
): PlayerCard {
  return {
    id,
    name,
    sport,
    season: '2022',
    notes: '',
    externalKey,
    rarityLabel: rarity,
    passKind: 'player',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function perf(
  id: string,
  cardId: string,
  rax: number,
  claimDay: string,
  base: number,
): RaxPerformance {
  return {
    id,
    cardId,
    claimDay,
    raxEarned: rax,
    baseRaxEarned: base,
    note: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function profile(
  externalKey: string,
  name: string,
  rows: Array<{ claimDay: string; baseRaxEarned: number }>,
): CatalogImportProfile {
  return {
    externalKey,
    entityId: 1,
    passKind: 'player',
    sport: 'Golf',
    seasonYear: 2022,
    seasonLabel: '2022',
    name,
    cachedAt: '2026-01-01T00:00:00.000Z',
    rowCount: rows.length,
    totalBaseRax: rows.reduce((sum, row) => sum + row.baseRaxEarned, 0),
    rows,
  }
}

function planned(
  partial: Pick<PlannedPass, 'id' | 'externalKey' | 'name'> & Partial<PlannedPass>,
): PlannedPass {
  return {
    sport: 'Golf',
    season: '2022',
    passKind: 'player',
    simulatedRarityLabel: RECOMMENDATION_SIMULATED_RARITY,
    totalBaseRax: 1,
    rowCount: 1,
    notes: '',
    source: 'catalog',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

describe('golf overlap parity (Justin vs Sahith style)', () => {
  const sharedDays = ['2022-06-01', '2022-06-02', '2022-06-03', '2022-06-04']
  const justinRows = sharedDays.map((day) => ({ claimDay: day, baseRaxEarned: 2 }))
  const sahithRows = sharedDays.map((day) => ({ claimDay: day, baseRaxEarned: 1.8 }))

  const justin = profile('jt|2022|Golf', 'Justin Thomas', justinRows)
  const sahith = profile('st|2022|Golf', 'Sahith Theegala', sahithRows)

  function emptyGolfData(): RaxTrackerData {
    const nba1 = card('nba1', 'NBA A', 'NBA', 'nba1')
    const nba2 = card('nba2', 'NBA B', 'NBA', 'nba2')
    const nba3 = card('nba3', 'NBA C', 'NBA', 'nba3')
    return {
      version: 1,
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [nba1, nba2, nba3],
      performances: [
        perf('n1', 'nba1', 500, '2022-06-01', 1),
        perf('n2', 'nba2', 400, '2022-06-01', 1),
        perf('n3', 'nba3', 350, '2022-06-01', 1),
      ],
      potentialCards: [],
      savedCardProfiles: [],
    }
  }

  function dataWithJustin(): RaxTrackerData {
    const base = emptyGolfData()
    const withJustin = applyCatalogProfilesAtOwnRarities(
      { ...base, settings: { ...base.settings, proBonusEnabled: true } },
      [profileAtSimulatedRarity(justin, RECOMMENDATION_SIMULATED_RARITY)],
    )
    return { ...withJustin, settings: { ...withJustin.settings, proBonusEnabled: false } }
  }

  it('rank, check-one, and import nets agree when Justin is already owned', () => {
    const data = dataWithJustin()
    const rank = analyzeCatalogCandidate(data, sahith)
    const imported = analyzeCatalogImportAtRarity(data, sahith, RECOMMENDATION_SIMULATED_RARITY)
    const check = analyzePotentialCard(
      data,
      {
        name: 'Sahith Theegala',
        sport: 'Golf',
        season: '2022',
        simulatedRarityLabel: RECOMMENDATION_SIMULATED_RARITY,
        passKind: 'player',
      },
      sahithRows.map((row) => ({
        claimDay: row.claimDay,
        raxEarned: row.baseRaxEarned,
        baseRaxEarned: row.baseRaxEarned,
        note: '',
      })),
    )
    const checkNet = check ? netWithProDelta(check) : null

    expect(rank?.netClaimableDelta).toBe(imported?.netClaimableDelta)
    expect(checkNet).toBe(imported?.netClaimableDelta)
  })

  it('plan leave-one-out for Sahith matches Rank after Justin is owned', () => {
    const data = emptyGolfData()
    const analysis = analyzePlanCollection(
      data,
      [
        planned({ id: 'p-jt', externalKey: justin.externalKey, name: justin.name }),
        planned({ id: 'p-st', externalKey: sahith.externalKey, name: sahith.name }),
      ],
      new Map([
        [justin.externalKey, justin],
        [sahith.externalKey, sahith],
      ]),
    )

    const sahithPlanNet = analysis.bundle?.rows.find((row) =>
      row.key.includes(sahith.externalKey),
    )?.marginalNetDelta

    const afterJustin = dataWithJustin()
    const rankAfterJustin = analyzeCatalogCandidate(afterJustin, sahith)
    expect(sahithPlanNet).toBe(rankAfterJustin?.netClaimableDelta)
  })
})

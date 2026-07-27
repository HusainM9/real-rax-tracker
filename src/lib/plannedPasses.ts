import type { CatalogImportProfile, CatalogSearchResult } from './catalogApi'
import { sportFromCatalog } from './catalogImport'
import { computeYearRollup } from './claimOptimizer'
import { isUfcCatalogSport } from '../../lib/passKind'
import {
  analyzeCatalogBundleImpactsAtProfileRarities,
  analyzeCatalogImportAtRarity,
  applyCatalogProfilesAtOwnRarities,
  estimateTotalRaxAtRarity,
  isAtLeastIconic1Rarity,
  isRecommendationPassOwnedAtIconic,
  profileAtSimulatedRarity,
  RECOMMENDATION_SIMULATED_RARITY,
  type OwnedIconicUpgradeImpactResult,
  type PassRecommendationRow,
} from './passRecommendation'
import type { PlayerCard, PlannedPass, RaxTrackerData } from '../types/rax'

export type PlannedPassInput = Pick<
  PlannedPass,
  | 'externalKey'
  | 'name'
  | 'sport'
  | 'season'
  | 'passKind'
  | 'simulatedRarityLabel'
  | 'totalBaseRax'
  | 'rowCount'
  | 'notes'
  | 'source'
>

export type PlannedPassCardAnalysis = {
  pass: PlannedPass
  profile: CatalogImportProfile | null
  solo: PassRecommendationRow | null
  ownedAtIconic: boolean
  ownedBelowIconic: boolean
  missingProfile: boolean
  missingRows: boolean
}

export type PlanCollectionAnalysis = {
  passes: PlannedPassCardAnalysis[]
  activeProfiles: CatalogImportProfile[]
  bundle: OwnedIconicUpgradeImpactResult | null
  currentClaimable: number
  currentGuaranteed: number
  withPlanClaimable: number
  withPlanGuaranteed: number
  combinedNetDelta: number
  combinedGuaranteedNetDelta: number
}

export function plannedPassFromCatalogResult(
  result: CatalogSearchResult,
  simulatedRarityLabel: string = RECOMMENDATION_SIMULATED_RARITY,
  source: PlannedPass['source'] = 'catalog',
): PlannedPassInput {
  return {
    externalKey: result.externalKey,
    name: result.name,
    sport: sportFromCatalog(result.sport),
    season: result.seasonLabel.trim() || String(result.seasonYear),
    passKind: isUfcCatalogSport(result.sport) ? 'player' : result.passKind,
    simulatedRarityLabel: simulatedRarityLabel.trim() || RECOMMENDATION_SIMULATED_RARITY,
    totalBaseRax: result.totalBaseRax,
    rowCount: result.rowCount,
    notes: '',
    source,
  }
}

export function plannedPassFromRecommendationRow(
  row: PassRecommendationRow,
  source: PlannedPass['source'] = 'ranking',
): PlannedPassInput {
  return {
    externalKey: row.externalKey,
    name: row.name,
    sport: row.sport,
    season: row.season,
    passKind: row.passKind,
    simulatedRarityLabel: row.rarityLabel?.trim() || RECOMMENDATION_SIMULATED_RARITY,
    totalBaseRax: row.totalBaseRax,
    rowCount: row.rowCount,
    notes: '',
    source,
  }
}

export function plannedPassFromOwnedCard(
  card: PlayerCard,
  options?: {
    simulatedRarityLabel?: string
    totalBaseRax?: number
    rowCount?: number
  },
): PlannedPassInput | null {
  const externalKey = card.externalKey?.trim()
  if (!externalKey) return null
  return {
    externalKey,
    name: card.name,
    sport: card.sport,
    season: card.season,
    passKind: card.passKind === 'team' ? 'team' : 'player',
    simulatedRarityLabel:
      options?.simulatedRarityLabel?.trim() || RECOMMENDATION_SIMULATED_RARITY,
    totalBaseRax: options?.totalBaseRax ?? 0,
    rowCount: options?.rowCount ?? 0,
    notes: '',
    source: 'manual',
  }
}

export function profileForPlannedPass(
  pass: PlannedPass,
  profilesByKey: Map<string, CatalogImportProfile>,
): CatalogImportProfile | null {
  const profile = profilesByKey.get(pass.externalKey)
  if (!profile) return null
  return profileAtSimulatedRarity(profile, pass.simulatedRarityLabel)
}

function findOwnedBelowIconicCard(
  data: RaxTrackerData,
  externalKey: string,
): PlayerCard | undefined {
  return data.cards.find(
    (card) =>
      card.externalKey === externalKey && !isAtLeastIconic1Rarity(card.rarityLabel),
  )
}

export function analyzePlanCollection(
  data: RaxTrackerData,
  plannedPasses: PlannedPass[],
  profilesByKey: Map<string, CatalogImportProfile>,
): PlanCollectionAnalysis {
  // Plan nets always assume Pro (same as Potential ranking / bundle what-ifs).
  const analysisData: RaxTrackerData = {
    ...data,
    settings: { ...data.settings, proBonusEnabled: true },
  }
  const currentRollup = computeYearRollup(analysisData)
  const passes: PlannedPassCardAnalysis[] = []
  const activeProfiles: CatalogImportProfile[] = []

  for (const pass of plannedPasses) {
    const profile = profileForPlannedPass(pass, profilesByKey)
    const ownedAtIconic = profile
      ? isRecommendationPassOwnedAtIconic(analysisData, profile)
      : analysisData.cards.some(
          (card) =>
            card.externalKey === pass.externalKey && isAtLeastIconic1Rarity(card.rarityLabel),
        )
    const ownedCard = findOwnedBelowIconicCard(analysisData, pass.externalKey)
    const ownedBelowIconic = Boolean(ownedCard) && !ownedAtIconic
    const missingProfile = !profile
    const missingRows = !profile || profile.rows.length === 0
    let solo: PassRecommendationRow | null = null

    if (profile && profile.rows.length > 0 && !ownedAtIconic) {
      const rarity = pass.simulatedRarityLabel.trim() || RECOMMENDATION_SIMULATED_RARITY
      // Same import/upgrade-in-place path as the plan bundle (not Potential phantom-card scoring).
      solo = analyzeCatalogImportAtRarity(analysisData, profile, rarity)
      if (solo) activeProfiles.push(profile)
    }

    passes.push({
      pass,
      profile,
      solo,
      ownedAtIconic,
      ownedBelowIconic,
      missingProfile,
      missingRows,
    })
  }

  let bundle: OwnedIconicUpgradeImpactResult | null = null
  let withPlanClaimable = currentRollup.totalClaimableRax
  let withPlanGuaranteed = currentRollup.totalGuaranteedRax
  let combinedNetDelta = 0
  let combinedGuaranteedNetDelta = 0

  if (activeProfiles.length > 0) {
    const greedyBundle = analyzeCatalogBundleImpactsAtProfileRarities(analysisData, activeProfiles)
    const withPlanData = applyCatalogProfilesAtOwnRarities(analysisData, activeProfiles)
    const withPlanRollup = computeYearRollup(withPlanData)
    withPlanClaimable = withPlanRollup.totalClaimableRax
    withPlanGuaranteed = withPlanRollup.totalGuaranteedRax
    combinedNetDelta = withPlanClaimable - currentRollup.totalClaimableRax
    combinedGuaranteedNetDelta = withPlanGuaranteed - currentRollup.totalGuaranteedRax

    // Per-pass plan net = leave-one-out contribution (not greedy add order).
    // leaveOneOut(P) = net(all) − net(all without P) — matches Check one / Rank vs the rest of the plan.
    const leaveOneOutByKey = new Map<string, number>()
    for (const profile of activeProfiles) {
      const others = activeProfiles.filter((item) => item.externalKey !== profile.externalKey)
      const withoutProfile =
        others.length > 0
          ? applyCatalogProfilesAtOwnRarities(analysisData, others)
          : analysisData
      const withoutClaimable = computeYearRollup(withoutProfile).totalClaimableRax
      const withoutNet = withoutClaimable - currentRollup.totalClaimableRax
      leaveOneOutByKey.set(profile.externalKey, combinedNetDelta - withoutNet)
    }

    bundle = {
      ...greedyBundle,
      combinedNetDelta,
      combinedGuaranteedNetDelta,
      rows: greedyBundle.rows.map((row) => {
        const externalKey = row.key.startsWith('catalog:')
          ? row.key.slice('catalog:'.length)
          : row.key.startsWith('owned:')
            ? row.key.slice('owned:'.length)
            : row.key
        return {
          ...row,
          marginalNetDelta: leaveOneOutByKey.get(externalKey) ?? row.marginalNetDelta,
        }
      }),
    }
  }

  return {
    passes,
    activeProfiles,
    bundle,
    currentClaimable: currentRollup.totalClaimableRax,
    currentGuaranteed: currentRollup.totalGuaranteedRax,
    withPlanClaimable,
    withPlanGuaranteed,
    combinedNetDelta,
    combinedGuaranteedNetDelta,
  }
}

export function plannedPassSimulatedTotalRax(
  pass: PlannedPass,
  profile: CatalogImportProfile | null,
): number {
  if (profile && profile.rows.length > 0) {
    return estimateTotalRaxAtRarity(
      profile,
      pass.simulatedRarityLabel.trim() || RECOMMENDATION_SIMULATED_RARITY,
    )
  }
  return pass.totalBaseRax
}

/** @deprecated Prefer plannedPassSimulatedTotalRax — kept for callers that still expect Iconic 1 naming. */
export function plannedPassIconic1TotalRax(
  pass: PlannedPass,
  profile: CatalogImportProfile | null,
): number {
  return plannedPassSimulatedTotalRax(pass, profile)
}

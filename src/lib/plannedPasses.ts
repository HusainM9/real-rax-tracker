import type { CatalogImportProfile, CatalogSearchResult } from './catalogApi'
import { sportFromCatalog } from './catalogImport'
import { computeYearRollup } from './claimOptimizer'
import {
  analyzeCatalogBundleImpacts,
  analyzeCatalogCandidate,
  applyRecommendationBaseline,
  estimateIconic1TotalRax,
  isAtLeastIconic1Rarity,
  isRecommendationPassOwnedAtIconic,
  profileAtSimulatedRarity,
  RECOMMENDATION_SIMULATED_RARITY,
  type OwnedIconicUpgradeImpactResult,
  type PassRecommendationRow,
  type RecommendationPassAdjustment,
} from './passRecommendation'
import type { PlannedPass, RaxTrackerData } from '../types/rax'

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
    passKind: result.passKind,
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

export function plannedPassToAdjustment(pass: PlannedPass): RecommendationPassAdjustment {
  return {
    externalKey: pass.externalKey,
    name: pass.name,
    sport: pass.sport,
    season: pass.season,
    mode: 'assume-iconic-1',
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

export function analyzePlanCollection(
  data: RaxTrackerData,
  plannedPasses: PlannedPass[],
  profilesByKey: Map<string, CatalogImportProfile>,
): PlanCollectionAnalysis {
  const currentRollup = computeYearRollup(data)
  const passes: PlannedPassCardAnalysis[] = []
  const activeProfiles: CatalogImportProfile[] = []

  for (const pass of plannedPasses) {
    const profile = profileForPlannedPass(pass, profilesByKey)
    const ownedAtIconic = profile
      ? isRecommendationPassOwnedAtIconic(data, profile)
      : data.cards.some(
          (card) =>
            card.externalKey === pass.externalKey && isAtLeastIconic1Rarity(card.rarityLabel),
        )
    const missingProfile = !profile
    const missingRows = !profile || profile.rows.length === 0
    let solo: PassRecommendationRow | null = null

    if (profile && profile.rows.length > 0 && !ownedAtIconic) {
      solo = analyzeCatalogCandidate(data, profile)
      if (solo) activeProfiles.push(profile)
    }

    passes.push({
      pass,
      profile,
      solo,
      ownedAtIconic,
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
    const simulatedRarity =
      activeProfiles[0]?.rarityLabel?.trim() || RECOMMENDATION_SIMULATED_RARITY
    bundle = analyzeCatalogBundleImpacts(data, activeProfiles, simulatedRarity)
    combinedNetDelta = bundle.combinedNetDelta
    combinedGuaranteedNetDelta = bundle.combinedGuaranteedNetDelta

    const adjustments = plannedPasses
      .filter((pass) => activeProfiles.some((profile) => profile.externalKey === pass.externalKey))
      .map(plannedPassToAdjustment)
    const withPlanData = applyRecommendationBaseline(data, profilesByKey, adjustments)
    const withPlanRollup = computeYearRollup(withPlanData)
    withPlanClaimable = withPlanRollup.totalClaimableRax
    withPlanGuaranteed = withPlanRollup.totalGuaranteedRax
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

export function plannedPassIconic1TotalRax(
  pass: PlannedPass,
  profile: CatalogImportProfile | null,
): number {
  if (profile && profile.rows.length > 0) {
    return estimateIconic1TotalRax(profile)
  }
  return pass.totalBaseRax
}

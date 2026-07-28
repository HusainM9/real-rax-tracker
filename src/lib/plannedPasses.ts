import type { CatalogImportProfile, CatalogSearchResult } from './catalogApi'
import { sportFromCatalog } from './catalogImport'
import { computeYearRollup } from './claimOptimizer'
import { isUfcCatalogSport } from '../../lib/passKind'
import {
  applyCatalogProfilesAtOwnRarities,
  estimateTotalRaxAtRarity,
  iconic20CatalogSelectionKey,
  isAtLeastIconic1Rarity,
  isRecommendationPassOwnedAtIconic,
  profileAtSimulatedRarity,
  RECOMMENDATION_SIMULATED_RARITY,
  type OwnedIconicUpgradeImpactResult,
  type PassRecommendationRow,
} from './passRecommendation'
import type { PlayerCard, PlannedPass, PlannedPassProgress, RaxTrackerData } from '../types/rax'

export const PLANNED_PASS_PROGRESS_OPTIONS: ReadonlyArray<{
  value: PlannedPassProgress
  label: string
  group: 'in-progress' | 'future'
  description: string
  /** CSS modifier: plan-tag--{tone} */
  tone: 'mint' | 'sky' | 'amber' | 'slate'
}> = [
  {
    value: 'nearly-finished',
    label: 'Nearly finished',
    group: 'in-progress',
    description: 'Close to buying / finishing',
    tone: 'mint',
  },
  {
    value: 'on-the-way',
    label: 'On the way',
    group: 'in-progress',
    description: 'Actively working toward these',
    tone: 'sky',
  },
  {
    value: 'just-started',
    label: 'Just started',
    group: 'in-progress',
    description: 'Early research or first steps',
    tone: 'amber',
  },
  {
    value: 'future',
    label: 'Future',
    group: 'future',
    description: 'Parked for later',
    tone: 'slate',
  },
]

export const DEFAULT_PLANNED_PASS_PROGRESS: PlannedPassProgress = 'just-started'

export function normalizePlannedPassProgress(
  value: string | undefined | null,
): PlannedPassProgress {
  if (
    value === 'nearly-finished' ||
    value === 'on-the-way' ||
    value === 'just-started' ||
    value === 'future'
  ) {
    return value
  }
  return DEFAULT_PLANNED_PASS_PROGRESS
}

export function plannedPassProgressLabel(progress: PlannedPassProgress): string {
  return (
    PLANNED_PASS_PROGRESS_OPTIONS.find((option) => option.value === progress)?.label ??
    'Just started'
  )
}

export function plannedPassProgressTone(
  progress: PlannedPassProgress,
): (typeof PLANNED_PASS_PROGRESS_OPTIONS)[number]['tone'] {
  return (
    PLANNED_PASS_PROGRESS_OPTIONS.find((option) => option.value === progress)?.tone ?? 'amber'
  )
}

export function plannedPassProgressSortIndex(progress: PlannedPassProgress): number {
  const index = PLANNED_PASS_PROGRESS_OPTIONS.findIndex((option) => option.value === progress)
  return index >= 0 ? index : PLANNED_PASS_PROGRESS_OPTIONS.length
}

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
  | 'progress'
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
    progress: DEFAULT_PLANNED_PASS_PROGRESS,
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
    progress: DEFAULT_PLANNED_PASS_PROGRESS,
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
    progress: DEFAULT_PLANNED_PASS_PROGRESS,
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

    // Skip per-pass import scoring here — Plan UI uses leave-one-out bundle nets.
    if (profile && profile.rows.length > 0 && !ownedAtIconic) {
      activeProfiles.push(profile)
    }

    passes.push({
      pass,
      profile,
      solo: null,
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
    const withPlanData = applyCatalogProfilesAtOwnRarities(analysisData, activeProfiles)
    const withPlanRollup = computeYearRollup(withPlanData)
    withPlanClaimable = withPlanRollup.totalClaimableRax
    withPlanGuaranteed = withPlanRollup.totalGuaranteedRax
    combinedNetDelta = withPlanClaimable - currentRollup.totalClaimableRax
    combinedGuaranteedNetDelta = withPlanGuaranteed - currentRollup.totalGuaranteedRax

    // Per-pass plan net = leave-one-out contribution (not greedy add order).
    const leaveOneOutByKey = new Map<string, number>()
    for (const profile of activeProfiles) {
      if (activeProfiles.length === 1) {
        leaveOneOutByKey.set(profile.externalKey, combinedNetDelta)
        continue
      }
      const others = activeProfiles.filter((item) => item.externalKey !== profile.externalKey)
      const withoutProfile = applyCatalogProfilesAtOwnRarities(analysisData, others)
      const withoutClaimable = computeYearRollup(withoutProfile).totalClaimableRax
      const withoutNet = withoutClaimable - currentRollup.totalClaimableRax
      leaveOneOutByKey.set(profile.externalKey, combinedNetDelta - withoutNet)
    }

    const rows = activeProfiles
      .map((profile) => {
        const marginal = leaveOneOutByKey.get(profile.externalKey) ?? 0
        return {
          key: iconic20CatalogSelectionKey(profile.externalKey),
          name: profile.name,
          sport: sportFromCatalog(profile.sport),
          season: profile.seasonLabel.trim() || String(profile.seasonYear),
          isolatedNetDelta: marginal,
          marginalNetDelta: marginal,
          passClaimableRax: 0,
          passGuaranteedRax: 0,
        }
      })
      .sort(
        (a, b) =>
          b.marginalNetDelta - a.marginalNetDelta || a.name.localeCompare(b.name),
      )

    bundle = {
      rows,
      combinedNetDelta,
      combinedGuaranteedNetDelta,
      combinedIsolatedNetDelta: rows.reduce((sum, row) => sum + row.isolatedNetDelta, 0),
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

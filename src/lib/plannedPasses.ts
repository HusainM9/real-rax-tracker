import type { CatalogImportProfile, CatalogSearchResult } from './catalogApi'
import { sportFromCatalog } from './catalogImport'
import { computeYearRollup } from './claimOptimizer'
import { getBaseRaxEarned, sportToMeowbotSlug } from './effectiveRax'
import { computeOtdRax } from './otdRax'
import { isUfcCatalogSport } from '../../lib/passKind'
import { isPlayerPass } from './passKind'
import { estimatePackProgress } from './packTracker'
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
import {
  rankAllRemovedCards,
  rankAllRemovedCardsAsync,
  type BulkSellRankResult,
  type BulkSellRankRow,
  type SellRankProgress,
} from './removeCardAnalysis'
import type {
  PackTracker,
  PlayerCard,
  PlannedPass,
  PlannedPassProgress,
  RaxTrackerData,
} from '../types/rax'

/** Options for Plan composition / if-sold scoring (Plan page only). */
export type AnalyzePlanCollectionOptions = {
  /** Force every planned pass profile to this rarity (e.g. Iconic 1 for if-sold). */
  forcePlannedRarityLabel?: string
  /** Simulation-only: treat every owned player pass as Iconic 1 before scoring. */
  assumeCollectionIconic1?: boolean
}

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
    description: '≤7 days to Iconic on Packs',
    tone: 'mint',
  },
  {
    value: 'on-the-way',
    label: 'On the way',
    group: 'in-progress',
    description: '8–31 days to Iconic on Packs',
    tone: 'sky',
  },
  {
    value: 'just-started',
    label: 'Just started',
    group: 'in-progress',
    description: 'Manual only — early research',
    tone: 'amber',
  },
  {
    value: 'future',
    label: 'Future',
    group: 'future',
    description: '31+ days to Iconic on Packs, or parked',
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

/**
 * Map Packs days-until-Iconic → Plan section tag.
 * Returns null when there is no ETA (or already at target) so Just started stays manual-only.
 * - ≤7 days → nearly-finished
 * - 8–31 days → on-the-way
 * - 32+ days → future
 */
export function planProgressFromPackDaysRemaining(
  daysRemaining: number | null | undefined,
): PlannedPassProgress | null {
  if (daysRemaining == null || !Number.isFinite(daysRemaining)) return null
  const days = Math.ceil(daysRemaining)
  if (days <= 0) return null
  if (days <= 7) return 'nearly-finished'
  if (days <= 31) return 'on-the-way'
  return 'future'
}

export function planProgressFromPackTracker(
  tracker: Pick<PackTracker, 'accounts'> & { ratingPerPack?: number },
): PlannedPassProgress | null {
  return planProgressFromPackDaysRemaining(estimatePackProgress(tracker).daysRemaining)
}

/** Apply Packs ETA tags onto planned passes. Does not write `just-started`. */
export function applyPackEtaToPlannedPasses(
  plannedPasses: PlannedPass[],
  packTrackers: readonly PackTracker[],
): { plannedPasses: PlannedPass[]; changed: boolean } {
  if (plannedPasses.length === 0 || packTrackers.length === 0) {
    return { plannedPasses, changed: false }
  }

  const trackerByPassId = new Map(
    packTrackers.map((tracker) => [tracker.plannedPassId, tracker] as const),
  )
  let changed = false
  const nextPasses = plannedPasses.map((pass) => {
    const tracker = trackerByPassId.get(pass.id)
    if (!tracker) return pass
    const suggested = planProgressFromPackTracker(tracker)
    if (!suggested || suggested === pass.progress) return pass
    changed = true
    return { ...pass, progress: suggested }
  })

  return { plannedPasses: changed ? nextPasses : plannedPasses, changed }
}

export function syncPlanProgressFromPackTrackers(data: RaxTrackerData): RaxTrackerData {
  const { plannedPasses, changed } = applyPackEtaToPlannedPasses(
    data.plannedPasses ?? [],
    data.packTrackers ?? [],
  )
  if (!changed) return data
  return { ...data, plannedPasses }
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
  | 'avatar'
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
    avatar: result.avatar,
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
    avatar: row.avatar,
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
    avatar: card.avatar,
  }
}

export function profileForPlannedPass(
  pass: PlannedPass,
  profilesByKey: Map<string, CatalogImportProfile>,
  forceRarityLabel?: string,
): CatalogImportProfile | null {
  const profile = profilesByKey.get(pass.externalKey)
  if (!profile) return null
  const rarity =
    forceRarityLabel?.trim() ||
    pass.simulatedRarityLabel.trim() ||
    RECOMMENDATION_SIMULATED_RARITY
  return profileAtSimulatedRarity(profile, rarity)
}

/**
 * Simulation-only: bump every owned player pass to Iconic 1 (recompute OTD from base).
 * Does not mutate persisted collection data.
 */
export function withCollectionAssumedIconic1(data: RaxTrackerData): RaxTrackerData {
  const rarity = RECOMMENDATION_SIMULATED_RARITY
  let changed = false
  const cards = data.cards.map((card) => {
    if (!isPlayerPass(card)) return card
    if (card.rarityLabel === rarity && !card.simulatedRarityLabel) return card
    changed = true
    return { ...card, rarityLabel: rarity, simulatedRarityLabel: undefined }
  })
  if (!changed) return data

  const performances = data.performances.map((performance) => {
    const original = data.cards.find((card) => card.id === performance.cardId)
    if (!original || !isPlayerPass(original)) return performance
    if (original.rarityLabel === rarity && !original.simulatedRarityLabel) return performance
    const base = getBaseRaxEarned(performance, original)
    return {
      ...performance,
      baseRaxEarned: base,
      raxEarned: computeOtdRax(
        base,
        sportToMeowbotSlug(original.sport),
        rarity,
        original.passKind ?? 'player',
      ),
    }
  })

  return { ...data, cards, performances }
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
  options?: AnalyzePlanCollectionOptions,
): PlanCollectionAnalysis {
  // Plan nets always assume Pro (same as Potential ranking / bundle what-ifs).
  let analysisData: RaxTrackerData = {
    ...data,
    settings: { ...data.settings, proBonusEnabled: true },
  }
  if (options?.assumeCollectionIconic1) {
    analysisData = withCollectionAssumedIconic1(analysisData)
  }
  const forcePlannedRarity = options?.forcePlannedRarityLabel?.trim() || undefined
  const currentRollup = computeYearRollup(analysisData)
  const passes: PlannedPassCardAnalysis[] = []
  const activeProfiles: CatalogImportProfile[] = []

  for (const pass of plannedPasses) {
    const profile = profileForPlannedPass(pass, profilesByKey, forcePlannedRarity)
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
          passKind: profile.passKind === 'team' ? ('team' as const) : ('player' as const),
          avatar: profile.avatar,
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

/** Where a card in the post-plan sell simulation came from. */
export type PlanFinishedCardSource = 'owned' | 'planned' | 'plan-upgrade'

export type PlanFinishedCollection = {
  data: RaxTrackerData
  sourceByCardId: Map<string, PlanFinishedCardSource>
  plannedExternalKeys: Set<string>
}

export type PlanFinishedSellRankRow = BulkSellRankRow & {
  source: PlanFinishedCardSource
  externalKey?: string
}

export type PlanFinishedSellRankResult = Omit<BulkSellRankResult, 'rankings'> & {
  rankings: PlanFinishedSellRankRow[]
}

/**
 * Simulate finishing the plan: optional collection→Iconic 1, then apply planned
 * buy/upgrade at Iconic 1. Used for post-plan sell ranking (not persisted).
 * Just-started planned passes are excluded unless `includeJustStarted` is true.
 */
export function buildPlanFinishedCollection(
  data: RaxTrackerData,
  plannedPasses: PlannedPass[],
  profilesByKey: Map<string, CatalogImportProfile>,
  options?: { assumeCollectionIconic1?: boolean; includeJustStarted?: boolean },
): PlanFinishedCollection {
  let working: RaxTrackerData = {
    ...data,
    settings: { ...data.settings, proBonusEnabled: true },
  }
  if (options?.assumeCollectionIconic1) {
    working = withCollectionAssumedIconic1(working)
  }

  const activePlannedPasses = plannedPasses.filter((pass) => {
    const progress = normalizePlannedPassProgress(pass.progress)
    if (progress === 'just-started' && !options?.includeJustStarted) return false
    return true
  })

  const beforeIds = new Set(working.cards.map((card) => card.id))
  const plannedExternalKeys = new Set(
    activePlannedPasses.map((pass) => pass.externalKey.trim()).filter(Boolean),
  )

  const profiles: CatalogImportProfile[] = []
  const seenIdentities = new Set<string>()
  for (const pass of activePlannedPasses) {
    const profile = profileForPlannedPass(pass, profilesByKey, RECOMMENDATION_SIMULATED_RARITY)
    if (!profile || profile.rows.length === 0) continue
    if (isRecommendationPassOwnedAtIconic(working, profile)) continue
    const identity = profile.externalKey
    if (seenIdentities.has(identity)) continue
    seenIdentities.add(identity)
    profiles.push(profile)
  }

  const finished = applyCatalogProfilesAtOwnRarities(working, profiles)
  const sourceByCardId = new Map<string, PlanFinishedCardSource>()
  for (const card of finished.cards) {
    const key = card.externalKey?.trim()
    const onPlan = Boolean(key && plannedExternalKeys.has(key))
    if (!beforeIds.has(card.id)) {
      sourceByCardId.set(card.id, 'planned')
    } else if (onPlan) {
      sourceByCardId.set(card.id, 'plan-upgrade')
    } else {
      sourceByCardId.set(card.id, 'owned')
    }
  }

  return { data: finished, sourceByCardId, plannedExternalKeys }
}

function attachPlanFinishedSources(
  result: BulkSellRankResult,
  sourceByCardId: Map<string, PlanFinishedCardSource>,
): PlanFinishedSellRankResult {
  return {
    ...result,
    rankings: result.rankings.map((row) => ({
      ...row,
      source: sourceByCardId.get(row.analysis.card.id) ?? 'owned',
      externalKey: row.analysis.card.externalKey,
    })),
  }
}

/** Sync sell-rank of collection + planned cards (planned at Iconic 1). */
export function rankPlanFinishedForSales(
  data: RaxTrackerData,
  plannedPasses: PlannedPass[],
  profilesByKey: Map<string, CatalogImportProfile>,
  options?: { assumeCollectionIconic1?: boolean; includeJustStarted?: boolean },
): PlanFinishedSellRankResult {
  const built = buildPlanFinishedCollection(data, plannedPasses, profilesByKey, options)
  return attachPlanFinishedSources(rankAllRemovedCards(built.data), built.sourceByCardId)
}

/** Async sell-rank after plan finishes — same math as /sell, on the simulated collection. */
export function rankPlanFinishedForSalesAsync(
  data: RaxTrackerData,
  plannedPasses: PlannedPass[],
  profilesByKey: Map<string, CatalogImportProfile>,
  options?: {
    assumeCollectionIconic1?: boolean
    includeJustStarted?: boolean
    onProgress?: (progress: SellRankProgress) => void
    signal?: AbortSignal
    batchSize?: number
  },
): Promise<PlanFinishedSellRankResult> {
  const built = buildPlanFinishedCollection(data, plannedPasses, profilesByKey, {
    assumeCollectionIconic1: options?.assumeCollectionIconic1,
    includeJustStarted: options?.includeJustStarted,
  })
  return rankAllRemovedCardsAsync(built.data, {
    onProgress: options?.onProgress,
    signal: options?.signal,
    batchSize: options?.batchSize,
  }).then((result) => attachPlanFinishedSources(result, built.sourceByCardId))
}

export function planFinishedSourceLabel(source: PlanFinishedCardSource): string {
  if (source === 'planned') return 'Plan'
  if (source === 'plan-upgrade') return 'Plan upgrade'
  return 'Owned'
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

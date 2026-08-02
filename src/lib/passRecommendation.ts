import {
  catalogPassIdentityKey,
  catalogPassIdentityKeyFromOwnedCard,
  dedupeCatalogPassSummaries,
  parseSeasonYearFromExternalKey,
} from '../../lib/catalogPassIdentity'
import { isUfcCatalogSport } from '../../lib/passKind'
import { isPlayerPass } from './passKind'
import type { CatalogImportProfile } from './catalogApi'
import type { CatalogSearchResult } from './catalogApi'
import { catalogProfileToJson, filteredCatalogProfileRows } from './catalogProfileJson'
import { sportFromCatalog, importCatalogProfileIntoData } from './catalogImport'
import { computeYearRollup } from './claimOptimizer'
import { CALENDAR_MONTH_NAMES } from './calendarView'
import { monthDayKeyFromClaimDay, monthIndexFromMonthDay } from './claimDayKey'
import { applyCardRarityChange } from './cardRarity'
import { formatClaimDay } from './format'
import {
  analyzePotentialCard,
  netGuaranteedDelta,
  netWithProDelta,
  type PotentialAnalysisResult,
} from './potentialAnalysis'
import { parseRealAppToolsRows, type ParsedRealAppToolsRow } from './realAppToolsImport'
import { computeOtdRax, parseRarityLabel } from './otdRax'
import { isLegendaryPlusRarity, normalizeRarityTier } from './rarityFilter'
import type { CatalogPassKind } from './catalogApi'
import { SPORTS, type PlayerCard, type RaxTrackerData, type Sport } from '../types/rax'

/** All recommendation what-if runs assume buying at this OTD tier. */
export const RECOMMENDATION_SIMULATED_RARITY = 'Iconic 1'

/** Iconic 20 what-if for owned upgrades and catalog preview passes. */
export const ICONIC_20_SIMULATED_RARITY = 'Iconic 20'

export function isIconicBelowLevel(rarityLabel: string | undefined, level: number): boolean {
  const parsed = parseRarityLabel(rarityLabel)
  return parsed.base === 'Iconic' && parsed.level < level
}

/** Default max catalog passes to fetch full daily rows for (sorted by base RAX). */
export const RECOMMENDATION_BULK_FETCH_CAP = 1000

/** Default max passes to run full claim simulation on per ranking pass. */
export const RECOMMENDATION_ANALYSIS_CAP = 400

/** Max candidates re-analyzed per greedy bundle pick after the first. */
export const RECOMMENDATION_GREEDY_RERANK_CAP = 80

/** Max passes in a recommended bundle. */
export const RECOMMENDATION_MAX_BUNDLE_SIZE = 20

export type RecommendationCaps = {
  bulkFetchCap: number
  analysisCap: number
  greedyRerankCap: number
}

/** Large-catalog sports get higher fetch and simulation limits. */
export function recommendationCapsForSport(sport: Sport): RecommendationCaps {
  switch (sport) {
    case 'MLB':
      return { bulkFetchCap: 2000, analysisCap: 750, greedyRerankCap: 150 }
    case 'FC':
    case 'CBB':
    case 'CFB':
      return { bulkFetchCap: 1500, analysisCap: 600, greedyRerankCap: 120 }
    default:
      return {
        bulkFetchCap: RECOMMENDATION_BULK_FETCH_CAP,
        analysisCap: RECOMMENDATION_ANALYSIS_CAP,
        greedyRerankCap: RECOMMENDATION_GREEDY_RERANK_CAP,
      }
  }
}

/** Combined caps when ranking multiple sports in one run (sum of per-sport limits). */
export function recommendationCapsForSports(sports: readonly Sport[]): RecommendationCaps {
  return sports.reduce(
    (acc, sport) => {
      const caps = recommendationCapsForSport(sport)
      return {
        bulkFetchCap: acc.bulkFetchCap + caps.bulkFetchCap,
        analysisCap: acc.analysisCap + caps.analysisCap,
        greedyRerankCap: acc.greedyRerankCap + caps.greedyRerankCap,
      }
    },
    { bulkFetchCap: 0, analysisCap: 0, greedyRerankCap: 0 },
  )
}

/** Combined caps when ranking every sport in one run (sum of per-sport limits). */
export function recommendationCapsForAllSports(): RecommendationCaps {
  return recommendationCapsForSports(SPORTS)
}

export type PassRecommendationRow = {
  externalKey: string
  name: string
  sport: Sport
  season: string
  seasonYear: number
  rarityLabel?: string
  passKind: CatalogPassKind
  /** Real CDN avatar key for player faces / team badges. */
  avatar?: string
  totalBaseRax: number
  iconic1TotalRax: number
  rowCount: number
  newClaimableRax: number
  displacedRax: number
  overlapRax: number
  netClaimableDelta: number
  netGuaranteedDelta: number
}

export type MonthPassRecommendationRow = PassRecommendationRow & {
  monthIdx: number
  month: string
  monthNetDelta: number
  monthGuaranteedNetDelta: number
  monthGain: number
  monthDisplaced: number
}

export type MonthPassRecommendationResult = {
  rows: MonthPassRecommendationRow[]
  skippedOwnedIconic: number
  skippedNoRows: number
  skippedAdjusted: number
  analyzedCount: number
  prefilterTrimmed: number
  monthIdx: number
  month: string
  /** OTD month-day (MM-DD) when ranking a single claim day instead of a full month. */
  claimDay?: string
}

export type PassRecommendationProgress = {
  current: number
  total: number
  label: string
}

export type PassRecommendationResult = {
  rows: PassRecommendationRow[]
  skippedOwnedIconic: number
  skippedNoRows: number
  skippedAdjusted: number
  analyzedCount: number
  prefilterTrimmed: number
}

export type PassRecommendationBundle = {
  picks: PassRecommendationRow[]
  combinedNetDelta: number
}

export type RankAndRecommendResult = {
  ranked: PassRecommendationResult
  bundle: PassRecommendationBundle
}

let recommendationIdCounter = 0

function nextRecommendationId(prefix: string): string {
  recommendationIdCounter += 1
  return `${prefix}-${recommendationIdCounter}`
}

export function isAtLeastIconic1Rarity(rarityLabel?: string): boolean {
  return normalizeRarityTier(rarityLabel ?? '') === 'Iconic'
}

export type RecommendationPassIdentityInput = {
  externalKey: string
  name: string
  sport: string
  passKind?: CatalogPassKind
  seasonYear?: number
  seasonLabel?: string
  season?: string
}

function recommendationPassIdentityFields(
  pass: RecommendationPassIdentityInput,
): Parameters<typeof catalogPassIdentityKey>[0] {
  return {
    passKind: pass.passKind ?? 'player',
    sport: pass.sport,
    seasonYear: pass.seasonYear ?? parseSeasonYearFromExternalKey(pass.externalKey) ?? 0,
    seasonLabel: pass.seasonLabel ?? pass.season,
    name: pass.name,
    externalKey: pass.externalKey,
  }
}

export function catalogPassIdentityKeyFromAdjustment(
  adjustment: RecommendationPassAdjustment,
): string {
  return catalogPassIdentityKey({
    passKind: 'player',
    sport: adjustment.sport,
    seasonYear: parseSeasonYearFromExternalKey(adjustment.externalKey) ?? 0,
    seasonLabel: adjustment.season,
    name: adjustment.name,
    externalKey: adjustment.externalKey,
  })
}

export function passMatchesRecommendationAdjustment(
  pass: RecommendationPassIdentityInput,
  adjustment: RecommendationPassAdjustment,
): boolean {
  if (pass.externalKey === adjustment.externalKey) return true
  return (
    catalogPassIdentityKey(recommendationPassIdentityFields(pass)) ===
    catalogPassIdentityKeyFromAdjustment(adjustment)
  )
}

export function isPassInRecommendationAdjustments(
  pass: RecommendationPassIdentityInput,
  adjustments?: RecommendationPassAdjustment[],
  options?: { mode?: RecommendationPassAdjustmentMode },
): boolean {
  if (!adjustments?.length) return false
  for (const adjustment of adjustments) {
    if (options?.mode && adjustment.mode !== options.mode) continue
    if (passMatchesRecommendationAdjustment(pass, adjustment)) return true
  }
  return false
}

export function resolveProfileForRecommendationAdjustment(
  adjustment: RecommendationPassAdjustment,
  profilesByKey: Map<string, CatalogImportProfile>,
): CatalogImportProfile | undefined {
  const direct = profilesByKey.get(adjustment.externalKey)
  if (direct?.rows.length) return direct

  for (const profile of profilesByKey.values()) {
    if (passMatchesRecommendationAdjustment(profile, adjustment) && profile.rows.length > 0) {
      return profile
    }
  }

  return direct
}

export function getRecommendationAdjustmentSets(adjustments?: RecommendationPassAdjustment[]): {
  assumeIconic1: Set<string>
  excluded: Set<string>
} {
  const assumeIconic1 = new Set<string>()
  const excluded = new Set<string>()
  for (const adjustment of adjustments ?? []) {
    if (adjustment.mode === 'assume-iconic-1') {
      assumeIconic1.add(adjustment.externalKey)
    } else {
      excluded.add(adjustment.externalKey)
    }
  }
  return { assumeIconic1, excluded }
}

export function countAppliedBaselineAdjustments(
  profilesByKey: Map<string, CatalogImportProfile>,
  adjustments?: RecommendationPassAdjustment[],
): number {
  const appliedIdentities = new Set<string>()
  let count = 0
  for (const adjustment of adjustments ?? []) {
    if (adjustment.mode !== 'assume-iconic-1') continue
    const profile = resolveProfileForRecommendationAdjustment(adjustment, profilesByKey)
    if (!profile || profile.rows.length === 0) continue
    const identity = catalogPassIdentityKey(profile)
    if (appliedIdentities.has(identity)) continue
    appliedIdentities.add(identity)
    count += 1
  }
  return count
}

/** Drop optional Rare/Epic player imports from ranking baselines; keep Legendary+ and teams. */
export function legendaryPlusBaselineCollection(data: RaxTrackerData): RaxTrackerData {
  const cards = data.cards.filter(
    (card) => !isPlayerPass(card) || isLegendaryPlusRarity(card.rarityLabel),
  )
  if (cards.length === data.cards.length) return data
  const cardIds = new Set(cards.map((card) => card.id))
  return {
    ...data,
    cards,
    performances: data.performances.filter((perf) => cardIds.has(perf.cardId)),
  }
}

export function applyRecommendationBaseline(
  data: RaxTrackerData,
  profilesByKey: Map<string, CatalogImportProfile>,
  adjustments?: RecommendationPassAdjustment[],
): RaxTrackerData {
  const appliedIdentities = new Set<string>()
  let workingData = legendaryPlusBaselineCollection(data)
  for (const adjustment of adjustments ?? []) {
    if (adjustment.mode !== 'assume-iconic-1') continue
    const profile = resolveProfileForRecommendationAdjustment(adjustment, profilesByKey)
    if (!profile || profile.rows.length === 0) continue
    const identity = catalogPassIdentityKey(profile)
    if (appliedIdentities.has(identity)) continue
    appliedIdentities.add(identity)
    workingData = addProfileToData(workingData, profile)
  }
  return workingData
}

export function shouldSkipRecommendationPass(
  data: RaxTrackerData,
  pass: CatalogImportProfile | CatalogSearchResult,
  adjustments?: RecommendationPassAdjustment[],
): boolean {
  if (isPassInRecommendationAdjustments(pass, adjustments)) return true

  const identity = catalogPassIdentityKey(pass)
  for (const card of data.cards) {
    if (pass.externalKey && card.externalKey === pass.externalKey) {
      if (isAtLeastIconic1Rarity(card.rarityLabel)) return true
    }
    if (catalogPassIdentityKeyFromOwnedCard(card) !== identity) continue
    if (isAtLeastIconic1Rarity(card.rarityLabel)) return true
  }

  return false
}

export function isRecommendationPassOwnedAtIconic(
  data: RaxTrackerData,
  pass: CatalogImportProfile | CatalogSearchResult,
): boolean {
  const identity = catalogPassIdentityKey(pass)
  for (const card of data.cards) {
    if (pass.externalKey && card.externalKey === pass.externalKey) {
      if (isAtLeastIconic1Rarity(card.rarityLabel)) return true
    }
    if (catalogPassIdentityKeyFromOwnedCard(card) !== identity) continue
    if (isAtLeastIconic1Rarity(card.rarityLabel)) return true
  }
  return false
}

export function netClaimableDelta(result: PotentialAnalysisResult): number {
  return netWithProDelta(result)
}

export { netGuaranteedDelta, netWithProDelta } from './potentialAnalysis'

/** UFC shop rows may still be pass_kind=team; ranking/OTD treat them as players. */
export function recommendationPassKind(profile: Pick<CatalogImportProfile, 'sport' | 'passKind'>): CatalogPassKind {
  return isUfcCatalogSport(profile.sport) ? 'player' : profile.passKind
}

export function estimateTotalRaxAtRarity(
  profile: CatalogImportProfile,
  rarityLabel: string,
): number {
  const sport = sportFromCatalog(profile.sport)
  const passKind = recommendationPassKind(profile)
  const rarity = rarityLabel.trim() || RECOMMENDATION_SIMULATED_RARITY
  return profile.rows.reduce(
    (sum, row) => sum + computeOtdRax(row.baseRaxEarned, sport, rarity, passKind),
    0,
  )
}

export function estimateIconic1TotalRax(profile: CatalogImportProfile): number {
  return estimateTotalRaxAtRarity(profile, RECOMMENDATION_SIMULATED_RARITY)
}

/** Normalize `bestDay` / `day` query values to an OTD month-day key (MM-DD). */
export function normalizeBestDayParam(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  const monthDay = monthDayKeyFromClaimDay(trimmed)
  if (!monthDay) return null
  const monthIdx = monthIndexFromMonthDay(monthDay)
  if (monthIdx < 0) return null
  return monthDay
}

export function estimateIconic1DayRax(profile: CatalogImportProfile, monthDay: string): number {
  const sport = sportFromCatalog(profile.sport)
  const passKind = recommendationPassKind(profile)
  return profile.rows.reduce((sum, row) => {
    if (monthDayKeyFromClaimDay(row.claimDay) !== monthDay) return sum
    return sum + computeOtdRax(row.baseRaxEarned, sport, RECOMMENDATION_SIMULATED_RARITY, passKind)
  }, 0)
}

export function profileHasEarningsOnMonthDay(
  profile: CatalogImportProfile,
  monthDay: string,
): boolean {
  return profile.rows.some((row) => monthDayKeyFromClaimDay(row.claimDay) === monthDay)
}

export function prefilterRecommendationProfilesForDay(
  profiles: CatalogImportProfile[],
  monthDay: string,
  cap: number = RECOMMENDATION_ANALYSIS_CAP,
): { profiles: CatalogImportProfile[]; trimmed: number; skippedNoDayRows: number } {
  const withDay = profiles.filter((profile) => profileHasEarningsOnMonthDay(profile, monthDay))
  const skippedNoDayRows = profiles.length - withDay.length
  if (withDay.length <= cap) {
    return { profiles: withDay, trimmed: 0, skippedNoDayRows }
  }

  const sorted = [...withDay].sort(
    (a, b) =>
      estimateIconic1DayRax(b, monthDay) - estimateIconic1DayRax(a, monthDay) ||
      a.name.localeCompare(b.name),
  )
  return {
    profiles: sorted.slice(0, cap),
    trimmed: withDay.length - cap,
    skippedNoDayRows,
  }
}

/** Keep the top N rows per sport (already sorted by day/month net). */
export function topRecommendationRowsPerSport<T extends { sport: Sport }>(
  rows: T[],
  perSport = 2,
): T[] {
  const limit = Math.max(0, Math.floor(perSport))
  if (limit === 0) return []
  const counts = new Map<Sport, number>()
  const selected: T[] = []
  for (const row of rows) {
    const count = counts.get(row.sport) ?? 0
    if (count >= limit) continue
    counts.set(row.sport, count + 1)
    selected.push(row)
  }
  return selected
}

function dayMetricsFromAnalysis(
  analysis: PotentialAnalysisResult,
  monthDay: string,
): {
  netDelta: number
  guaranteedNetDelta: number
  gain: number
  displaced: number
} {
  let gain = 0
  let guaranteedGain = 0
  let displaced = 0
  let guaranteedDisplaced = 0

  for (const { day, candidate } of analysis.candidates) {
    if (day.claimDay !== monthDay || candidate.status === 'overlap') continue
    gain += candidate.performance.raxEarned
    if (candidate.status === 'guaranteed') {
      guaranteedGain += candidate.performance.raxEarned
    }
  }

  for (const { day, candidate, previousStatus } of analysis.displacedExisting) {
    if (day.claimDay !== monthDay) continue
    displaced += candidate.performance.raxEarned
    if (previousStatus === 'guaranteed') {
      guaranteedDisplaced += candidate.performance.raxEarned
    }
  }

  return {
    netDelta: gain - displaced,
    guaranteedNetDelta: guaranteedGain - guaranteedDisplaced,
    gain,
    displaced,
  }
}

export function catalogProfileToParsedRows(profile: CatalogImportProfile): ParsedRealAppToolsRow[] {
  const sport = sportFromCatalog(profile.sport)
  const filteredRows = filteredCatalogProfileRows(profile)
  const rawJson = catalogProfileToJson({ rows: filteredRows })
  const parsed = parseRealAppToolsRows(rawJson, {
    sport,
    passKind: recommendationPassKind(profile),
    applyOtdMultiplier: false,
  })
  return parsed.rows
}

/** Always simulate buy-at Iconic 1 — ignore catalog rarity_label (shop/Meowbot leftovers). */
export function profileAsIconic1(profile: CatalogImportProfile): CatalogImportProfile {
  return {
    ...profile,
    rarityLabel: RECOMMENDATION_SIMULATED_RARITY,
    passKind: recommendationPassKind(profile),
  }
}

export function profileAtSimulatedRarity(
  profile: CatalogImportProfile,
  rarityLabel: string,
): CatalogImportProfile {
  return {
    ...profile,
    rarityLabel,
    passKind: recommendationPassKind(profile),
  }
}

export type RecommendationPassAdjustmentMode = 'assume-iconic-1' | 'exclude'

export type RecommendationPassAdjustment = {
  externalKey: string
  name: string
  sport: Sport
  season: string
  mode: RecommendationPassAdjustmentMode
  passKind?: CatalogPassKind
  /** Real CDN avatar key when known at add time (search / owned / ranking). */
  avatar?: string
}

export function recommendationAdjustmentFromPass(
  pass: {
    externalKey: string
    name: string
    sport: string
    season?: string
    seasonLabel?: string
    seasonYear?: number
    passKind?: CatalogPassKind
    avatar?: string
  },
  mode: RecommendationPassAdjustmentMode,
): RecommendationPassAdjustment {
  return {
    externalKey: pass.externalKey,
    name: pass.name,
    sport: sportFromCatalog(pass.sport),
    season:
      pass.season?.trim() ||
      pass.seasonLabel?.trim() ||
      (pass.seasonYear != null ? String(pass.seasonYear) : ''),
    mode,
    passKind: pass.passKind === 'team' ? 'team' : 'player',
    avatar: pass.avatar?.trim() || undefined,
  }
}

export type RecommendationSeasonFilter = {
  /** Keys like `NFL|2022-23` — excludes that sport+season pair only. */
  excludedSportSeasonKeys?: string[]
}

export type RecommendationFilterOptions = RecommendationSeasonFilter & {
  adjustments?: RecommendationPassAdjustment[]
}

/**
 * Default Rank OTD Net sport+season exclusions.
 * Keys use season labels (`2022-23`), not seasonYear — NFL/NHL are start-year encoded
 * (`seasonYear` 2022 → label `2022-23`); CBB is end-year (`seasonYear` 2023 → `2022-23`).
 */
export const DEFAULT_RANK_EXCLUDED_SPORT_SEASONS: ReadonlyArray<{
  sport: Sport
  seasonLabel: string
}> = [
  { sport: 'NFL', seasonLabel: '2022-23' },
  { sport: 'NHL', seasonLabel: '2022-23' },
  { sport: 'CBB', seasonLabel: '2022-23' },
]

export function seasonLabelForFilter(item: { seasonLabel: string; seasonYear: number }): string {
  const label = item.seasonLabel.trim()
  return label || String(item.seasonYear)
}

export function sportSeasonFilterKey(sport: Sport, seasonLabel: string): string {
  return `${sport}|${seasonLabel}`
}

export function defaultRankExcludedSportSeasonKeys(): string[] {
  return DEFAULT_RANK_EXCLUDED_SPORT_SEASONS.map((entry) =>
    sportSeasonFilterKey(entry.sport, entry.seasonLabel),
  )
}

/** Drop UFC from Rank OTD Net sports when Include UFC is off (default on). */
export function filterRankCatalogSports(
  sports: readonly Sport[],
  includeUfc = true,
): Sport[] {
  if (includeUfc) return [...sports]
  return sports.filter((sport) => sport !== 'UFC')
}

export function passSeasonIncluded(
  item: { sport: string; seasonLabel: string; seasonYear: number },
  excludedSportSeasonKeys?: string[],
): boolean {
  if (!excludedSportSeasonKeys?.length) return true
  const sport = sportFromCatalog(item.sport)
  const seasonLabel = seasonLabelForFilter(item)
  return !excludedSportSeasonKeys.includes(sportSeasonFilterKey(sport, seasonLabel))
}

export function filterRecommendationProfiles(
  data: RaxTrackerData,
  profiles: CatalogImportProfile[],
  options?: RecommendationFilterOptions,
): {
  candidates: CatalogImportProfile[]
  skippedOwnedIconic: number
  skippedNoRows: number
  skippedAdjusted: number
} {
  let skippedOwnedIconic = 0
  let skippedNoRows = 0
  let skippedAdjusted = 0
  const candidates: CatalogImportProfile[] = []
  const { items: dedupedProfiles } = dedupeCatalogPassSummaries(profiles)

  for (const profile of dedupedProfiles) {
    if (isPassInRecommendationAdjustments(profile, options?.adjustments)) {
      skippedAdjusted += 1
      continue
    }
    if (shouldSkipRecommendationPass(data, profile, options?.adjustments)) {
      skippedOwnedIconic += 1
      continue
    }
    if (profile.rows.length === 0) {
      skippedNoRows += 1
      continue
    }
    if (!passSeasonIncluded(profile, options?.excludedSportSeasonKeys)) {
      continue
    }
    candidates.push(profile)
  }

  return { candidates, skippedOwnedIconic, skippedNoRows, skippedAdjusted }
}

export function selectSummariesForBulkFetch(
  data: RaxTrackerData,
  summaries: CatalogSearchResult[],
  options?: RecommendationFilterOptions & { cap?: number; sport?: Sport },
): {
  keys: string[]
  skippedOwnedIconic: number
  skippedAdjusted: number
  fetchTrimmed: number
} {
  const cap =
    options?.cap ??
    (options?.sport ? recommendationCapsForSport(options.sport).bulkFetchCap : RECOMMENDATION_BULK_FETCH_CAP)
  let skippedOwnedIconic = 0
  let skippedAdjusted = 0
  const eligible: CatalogSearchResult[] = []
  const { items: dedupedSummaries } = dedupeCatalogPassSummaries(summaries)

  for (const summary of dedupedSummaries) {
    if (summary.rowCount <= 0) continue
    if (!passSeasonIncluded(summary, options?.excludedSportSeasonKeys)) continue
    if (isPassInRecommendationAdjustments(summary, options?.adjustments)) {
      skippedAdjusted += 1
      continue
    }
    if (shouldSkipRecommendationPass(data, summary, options?.adjustments)) {
      skippedOwnedIconic += 1
      continue
    }
    eligible.push(summary)
  }

  eligible.sort((a, b) => b.totalBaseRax - a.totalBaseRax || a.name.localeCompare(b.name))
  const selected = eligible.slice(0, cap)
  return {
    keys: selected.map((item) => item.externalKey),
    skippedOwnedIconic,
    skippedAdjusted,
    fetchTrimmed: Math.max(0, eligible.length - selected.length),
  }
}

export function prefilterRecommendationProfiles(
  profiles: CatalogImportProfile[],
  cap: number = RECOMMENDATION_ANALYSIS_CAP,
): { profiles: CatalogImportProfile[]; trimmed: number } {
  if (profiles.length <= cap) {
    return { profiles, trimmed: 0 }
  }

  const sorted = [...profiles].sort(
    (a, b) =>
      estimateIconic1TotalRax(b) - estimateIconic1TotalRax(a) || a.name.localeCompare(b.name),
  )
  return {
    profiles: sorted.slice(0, cap),
    trimmed: profiles.length - cap,
  }
}

export function analyzeCatalogCandidate(
  data: RaxTrackerData,
  profile: CatalogImportProfile,
): PassRecommendationRow | null {
  // Same import / in-place upgrade path as Plan + Check-one collection deltas.
  return analyzeCatalogImportAtRarity(data, profile, RECOMMENDATION_SIMULATED_RARITY)
}

/** Score a catalog pass at an explicit OTD rarity via potential phantom-card analysis. */
export function analyzeCatalogCandidateAtRarity(
  data: RaxTrackerData,
  profile: CatalogImportProfile,
  rarityLabel: string,
): PassRecommendationRow | null {
  const rarity = rarityLabel.trim() || RECOMMENDATION_SIMULATED_RARITY
  const analysis = analyzeCatalogProfilePotentialAtRarity(data, profile, rarity)
  if (!analysis) return null
  return buildPassRecommendationRow(profileAtSimulatedRarity(profile, rarity), analysis)
}

/**
 * Score adding/upgrading a catalog profile at a rarity via the same import path the plan
 * bundle uses (in-place upgrade when already owned). Prefer this for Plan page nets.
 */
export function analyzeCatalogImportAtRarity(
  data: RaxTrackerData,
  profile: CatalogImportProfile,
  rarityLabel: string,
): PassRecommendationRow | null {
  if (profile.rows.length === 0) return null
  const rarity = rarityLabel.trim() || RECOMMENDATION_SIMULATED_RARITY
  const simulated = profileAtSimulatedRarity(profile, rarity)
  const after = addProfileToDataAtRarity(data, profile, rarity)
  const deltas = collectionNetDeltas(data, after)
  const cardId = after.cards.find((card) => card.externalKey === simulated.externalKey)?.id
  const totals = cardId
    ? cardClaimableTotals(after, cardId)
    : { claimable: 0, guaranteed: 0, overlap: 0 }
  const sport = sportFromCatalog(simulated.sport)
  const passKind = recommendationPassKind(simulated)
  return {
    externalKey: simulated.externalKey,
    name: simulated.name,
    sport,
    season: simulated.seasonLabel || String(simulated.seasonYear),
    seasonYear: simulated.seasonYear,
    rarityLabel: rarity,
    passKind,
    avatar: simulated.avatar,
    totalBaseRax: simulated.totalBaseRax,
    iconic1TotalRax: estimateTotalRaxAtRarity(simulated, rarity),
    rowCount: simulated.rows.length,
    newClaimableRax: totals.claimable,
    displacedRax: Math.max(0, totals.claimable - deltas.withPro),
    overlapRax: totals.overlap,
    netClaimableDelta: deltas.withPro,
    netGuaranteedDelta: deltas.guaranteed,
  }
}

/**
 * Net gain from upgrading an owned card to a target rarity (Plan page owned auto-adds).
 * Uses the same in-place upgrade path as the plan bundle.
 */
export function analyzeOwnedCardUpgradeAtRarity(
  data: RaxTrackerData,
  card: PlayerCard,
  profile: CatalogImportProfile,
  rarityLabel: string,
): PassRecommendationRow | null {
  if (profile.rows.length === 0) return null
  const rarity = rarityLabel.trim() || RECOMMENDATION_SIMULATED_RARITY
  const simulated = profileAtSimulatedRarity(profile, rarity)
  const after = applyOwnedCardRarityUpgrade(data, card, rarity)
  const deltas = collectionNetDeltas(data, after)
  const totals = cardClaimableTotals(after, card.id)
  const sport = sportFromCatalog(simulated.sport)
  const passKind = recommendationPassKind(simulated)
  return {
    externalKey: simulated.externalKey,
    name: simulated.name,
    sport,
    season: simulated.seasonLabel || String(simulated.seasonYear),
    seasonYear: simulated.seasonYear,
    rarityLabel: rarity,
    passKind,
    avatar: card.avatar?.trim() || simulated.avatar,
    totalBaseRax: simulated.totalBaseRax,
    iconic1TotalRax: estimateTotalRaxAtRarity(simulated, rarity),
    rowCount: simulated.rows.length,
    newClaimableRax: totals.claimable,
    displacedRax: Math.max(0, totals.claimable - deltas.withPro),
    overlapRax: totals.overlap,
    netClaimableDelta: deltas.withPro,
    netGuaranteedDelta: deltas.guaranteed,
  }
}

function analyzeCatalogProfilePotential(
  data: RaxTrackerData,
  profile: CatalogImportProfile,
): PotentialAnalysisResult | null {
  // Rank/solo parity: always score at Iconic 1, never the catalog's stored rarity_label.
  return analyzeCatalogProfilePotentialAtRarity(data, profile, RECOMMENDATION_SIMULATED_RARITY)
}

function analyzeCatalogProfilePotentialAtRarity(
  data: RaxTrackerData,
  profile: CatalogImportProfile,
  rarityLabel: string,
): PotentialAnalysisResult | null {
  if (profile.rows.length === 0) return null

  const simulated = profileAtSimulatedRarity(profile, rarityLabel)
  const rows = catalogProfileToParsedRows(simulated)
  if (rows.length === 0) return null

  const sport = sportFromCatalog(simulated.sport)
  return analyzePotentialCard(
    data,
    {
      name: simulated.name,
      sport,
      season: simulated.seasonLabel || String(simulated.seasonYear),
      simulatedRarityLabel: simulated.rarityLabel,
      passKind: simulated.passKind,
    },
    rows,
  )
}

function buildPassRecommendationRow(
  profile: CatalogImportProfile,
  analysis: PotentialAnalysisResult,
): PassRecommendationRow {
  const sport = sportFromCatalog(profile.sport)
  const passKind = recommendationPassKind(profile)
  const rarityLabel = profile.rarityLabel?.trim() || RECOMMENDATION_SIMULATED_RARITY
  return {
    externalKey: profile.externalKey,
    name: profile.name,
    sport,
    season: profile.seasonLabel || String(profile.seasonYear),
    seasonYear: profile.seasonYear,
    rarityLabel,
    passKind,
    avatar: profile.avatar,
    totalBaseRax: profile.totalBaseRax,
    iconic1TotalRax: estimateTotalRaxAtRarity(profile, rarityLabel),
    rowCount: profile.rows.length,
    newClaimableRax: analysis.claimableRax,
    displacedRax: analysis.displacedRax,
    overlapRax: analysis.overlapRax,
    netClaimableDelta: netClaimableDelta(analysis),
    netGuaranteedDelta: netGuaranteedDelta(analysis),
  }
}

export function analyzeCatalogCandidateForMonth(
  data: RaxTrackerData,
  profile: CatalogImportProfile,
  monthIdx: number,
): MonthPassRecommendationRow | null {
  const analysis = analyzeCatalogProfilePotential(data, profile)
  if (!analysis) return null

  const monthly = analysis.monthlyNet.find((row) => row.monthIdx === monthIdx)
  const base = buildPassRecommendationRow(profileAsIconic1(profile), analysis)

  return {
    ...base,
    monthIdx,
    month: CALENDAR_MONTH_NAMES[monthIdx] ?? 'Other',
    monthNetDelta: monthly?.netDelta ?? 0,
    monthGuaranteedNetDelta: monthly?.guaranteedNetDelta ?? 0,
    monthGain: monthly?.potentialGain ?? 0,
    monthDisplaced: monthly?.displacedLoss ?? 0,
  }
}

export function analyzeCatalogCandidateForDay(
  data: RaxTrackerData,
  profile: CatalogImportProfile,
  monthDay: string,
): MonthPassRecommendationRow | null {
  const normalizedDay = normalizeBestDayParam(monthDay)
  if (!normalizedDay) return null
  if (!profileHasEarningsOnMonthDay(profile, normalizedDay)) return null

  const analysis = analyzeCatalogProfilePotential(data, profile)
  if (!analysis) return null

  const metrics = dayMetricsFromAnalysis(analysis, normalizedDay)
  const base = buildPassRecommendationRow(profileAsIconic1(profile), analysis)
  const monthIdx = monthIndexFromMonthDay(normalizedDay)

  return {
    ...base,
    monthIdx,
    month: formatClaimDay(normalizedDay),
    monthNetDelta: metrics.netDelta,
    monthGuaranteedNetDelta: metrics.guaranteedNetDelta,
    monthGain: metrics.gain,
    monthDisplaced: metrics.displaced,
  }
}

function sortMonthRecommendationRows(rows: MonthPassRecommendationRow[]): MonthPassRecommendationRow[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.monthNetDelta - a.monthNetDelta ||
      b.netClaimableDelta - a.netClaimableDelta ||
      b.monthGain - a.monthGain ||
      a.name.localeCompare(b.name),
  )
  return dedupeCatalogPassSummaries(sorted).items as MonthPassRecommendationRow[]
}

function sortRecommendationRows(rows: PassRecommendationRow[]): PassRecommendationRow[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.netClaimableDelta - a.netClaimableDelta ||
      b.newClaimableRax - a.newClaimableRax ||
      a.name.localeCompare(b.name),
  )
  return dedupeCatalogPassSummaries(sorted).items
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0)
  })
}

function addProfileToData(data: RaxTrackerData, profile: CatalogImportProfile): RaxTrackerData {
  const { data: nextData } = importCatalogProfileIntoData(data, profileAsIconic1(profile), {
    nowIso: new Date().toISOString(),
    createId: (prefix) => nextRecommendationId(prefix),
  })
  return nextData
}

export function addProfileToDataAtRarity(
  data: RaxTrackerData,
  profile: CatalogImportProfile,
  rarityLabel: string,
): RaxTrackerData {
  const { data: nextData } = importCatalogProfileIntoData(
    data,
    profileAtSimulatedRarity(profile, rarityLabel),
    {
      nowIso: new Date().toISOString(),
      createId: (prefix) => nextRecommendationId(prefix),
    },
  )
  return nextData
}

/** Apply each profile at its own `rarityLabel` (Plan page mixed-rarity with-plan totals). */
export function applyCatalogProfilesAtOwnRarities(
  data: RaxTrackerData,
  profiles: CatalogImportProfile[],
): RaxTrackerData {
  const appliedIdentities = new Set<string>()
  let workingData = data
  for (const profile of profiles) {
    if (profile.rows.length === 0) continue
    const identity = catalogPassIdentityKey(profile)
    if (appliedIdentities.has(identity)) continue
    appliedIdentities.add(identity)
    workingData = addProfileToDataAtRarity(
      workingData,
      profile,
      profile.rarityLabel?.trim() || RECOMMENDATION_SIMULATED_RARITY,
    )
  }
  return workingData
}

export type OwnedIconicUpgradeCandidate = {
  key: string
  name: string
  sport: Sport
  season: string
  card?: PlayerCard
  profile?: CatalogImportProfile
}

export type OwnedIconicUpgradeImpactRow = {
  key: string
  name: string
  sport: Sport
  season: string
  passKind?: CatalogPassKind
  avatar?: string
  isolatedNetDelta: number
  marginalNetDelta: number
  /** Full claimable RAX from this pass alone after upgrade (guaranteed + Pro bonus). */
  passClaimableRax: number
  /** Guaranteed-only claimable RAX from this pass alone after upgrade. */
  passGuaranteedRax: number
}

function impactIdentityFromCandidate(candidate: {
  card?: PlayerCard
  profile?: CatalogImportProfile
}): Pick<OwnedIconicUpgradeImpactRow, 'passKind' | 'avatar'> {
  return {
    passKind:
      candidate.card?.passKind === 'team' || candidate.profile?.passKind === 'team'
        ? 'team'
        : 'player',
    avatar: candidate.card?.avatar?.trim() || candidate.profile?.avatar?.trim() || undefined,
  }
}

export type OwnedIconicUpgradeImpactResult = {
  /** Per-pass rows sorted by marginal net RAX (highest first). */
  rows: OwnedIconicUpgradeImpactRow[]
  /** Net claimable gain after all upgrades (greedy same-sport order by isolated value). */
  combinedNetDelta: number
  /** Guaranteed-only net gain (top 2 per sport). */
  combinedGuaranteedNetDelta: number
  /** Sum of each pass upgraded alone — overcounts when same-sport passes overlap. */
  combinedIsolatedNetDelta: number
}

function withProBonusAnalysisData(data: RaxTrackerData): RaxTrackerData {
  return {
    ...data,
    settings: { ...data.settings, proBonusEnabled: true },
  }
}

function collectionClaimableTotal(data: RaxTrackerData): number {
  // Match collectionNetDeltas / ranking what-ifs: always score with Pro enabled.
  return computeYearRollup(withProBonusAnalysisData(data)).totalClaimableRax
}

function collectionGuaranteedTotal(data: RaxTrackerData): number {
  return computeYearRollup(data).totalGuaranteedRax
}

function collectionNetDeltas(
  before: RaxTrackerData,
  after: RaxTrackerData,
): { guaranteed: number; withPro: number } {
  const beforePro = withProBonusAnalysisData(before)
  const afterPro = withProBonusAnalysisData(after)
  return {
    guaranteed:
      collectionGuaranteedTotal(afterPro) - collectionGuaranteedTotal(beforePro),
    withPro: collectionClaimableTotal(afterPro) - collectionClaimableTotal(beforePro),
  }
}

function resolveCandidateExternalKey(candidate: {
  key: string
  card?: PlayerCard
  profile?: CatalogImportProfile
}): string | undefined {
  return candidate.card?.externalKey ?? candidate.profile?.externalKey
}

function findCardIdForCandidate(
  data: RaxTrackerData,
  candidate: { key: string; card?: PlayerCard; profile?: CatalogImportProfile },
): string | null {
  if (candidate.card) return candidate.card.id
  const externalKey = resolveCandidateExternalKey(candidate)
  if (!externalKey) return null
  return data.cards.find((card) => card.externalKey === externalKey)?.id ?? null
}

function cardClaimableTotals(
  data: RaxTrackerData,
  cardId: string,
): { claimable: number; guaranteed: number; overlap: number } {
  const rollup = computeYearRollup(withProBonusAnalysisData(data))
  const row = rollup.cards.find((entry) => entry.card.id === cardId)
  return {
    claimable: row?.totalClaimableRax ?? 0,
    guaranteed: row?.guaranteedRax ?? 0,
    overlap: row?.overlapRax ?? 0,
  }
}

function applyOwnedCardRarityUpgrade(
  data: RaxTrackerData,
  card: PlayerCard,
  targetRarity: string,
): RaxTrackerData {
  return applyCardRarityChange(data, card.id, targetRarity) ?? data
}

function applyOwnedCardIconicUpgrade(data: RaxTrackerData, card: PlayerCard): RaxTrackerData {
  return applyOwnedCardRarityUpgrade(data, card, RECOMMENDATION_SIMULATED_RARITY)
}

function applyIconicUpgradeCandidate(
  data: RaxTrackerData,
  candidate: OwnedIconicUpgradeCandidate,
): RaxTrackerData {
  if (candidate.card) {
    return applyOwnedCardIconicUpgrade(data, candidate.card)
  }
  if (candidate.profile?.rows.length) {
    return addProfileToData(data, candidate.profile)
  }
  return data
}

export function ownedCardToIconicUpgradeCandidate(
  card: PlayerCard,
): OwnedIconicUpgradeCandidate | null {
  if (!card.externalKey) return null
  return {
    key: card.externalKey,
    name: card.name,
    sport: card.sport,
    season: card.season,
    card,
  }
}

export function analyzeOwnedIconicUpgradeImpacts(
  data: RaxTrackerData,
  candidates: OwnedIconicUpgradeCandidate[],
): OwnedIconicUpgradeImpactResult {
  const eligible = candidates.filter((candidate) => candidate.card || candidate.profile?.rows.length)
  if (eligible.length === 0) {
    return {
      rows: [],
      combinedNetDelta: 0,
      combinedGuaranteedNetDelta: 0,
      combinedIsolatedNetDelta: 0,
    }
  }

  const isolatedByKey = new Map<string, number>()
  const passClaimableByKey = new Map<string, { claimable: number; guaranteed: number }>()
  for (const candidate of eligible) {
    const upgraded = applyIconicUpgradeCandidate(data, candidate)
    const before = collectionClaimableTotal(data)
    const after = collectionClaimableTotal(upgraded)
    isolatedByKey.set(candidate.key, after - before)
    const cardId = findCardIdForCandidate(upgraded, candidate)
    if (cardId) {
      passClaimableByKey.set(candidate.key, cardClaimableTotals(upgraded, cardId))
    }
  }

  const bySport = new Map<Sport, OwnedIconicUpgradeCandidate[]>()
  for (const candidate of eligible) {
    const list = bySport.get(candidate.sport) ?? []
    list.push(candidate)
    bySport.set(candidate.sport, list)
  }

  const rows: OwnedIconicUpgradeImpactRow[] = []
  let workingData = data
  for (const sport of [...bySport.keys()].sort()) {
    const ordered = [...(bySport.get(sport) ?? [])].sort(
      (a, b) => (isolatedByKey.get(b.key) ?? 0) - (isolatedByKey.get(a.key) ?? 0),
    )
    for (const candidate of ordered) {
      const before = collectionClaimableTotal(workingData)
      workingData = applyIconicUpgradeCandidate(workingData, candidate)
      const after = collectionClaimableTotal(workingData)
      rows.push({
        key: candidate.key,
        name: candidate.name,
        sport: candidate.sport,
        season: candidate.season,
        ...impactIdentityFromCandidate(candidate),
        isolatedNetDelta: isolatedByKey.get(candidate.key) ?? 0,
        marginalNetDelta: after - before,
        passClaimableRax: passClaimableByKey.get(candidate.key)?.claimable ?? 0,
        passGuaranteedRax: passClaimableByKey.get(candidate.key)?.guaranteed ?? 0,
      })
    }
  }

  const combined = collectionNetDeltas(data, workingData)

  // Display order for per-pass contribution: highest net RAX first.
  rows.sort(
    (a, b) =>
      b.marginalNetDelta - a.marginalNetDelta ||
      b.passClaimableRax - a.passClaimableRax ||
      a.name.localeCompare(b.name),
  )

  return {
    rows,
    combinedNetDelta: combined.withPro,
    combinedGuaranteedNetDelta: combined.guaranteed,
    combinedIsolatedNetDelta: [...isolatedByKey.values()].reduce((sum, value) => sum + value, 0),
  }
}

export function ownedIconicUpgradeImpactByKey(
  result: OwnedIconicUpgradeImpactResult,
): Map<string, OwnedIconicUpgradeImpactRow> {
  return new Map(result.rows.map((row) => [row.key, row]))
}

export type Iconic20CheckerCandidateSource = 'owned' | 'catalog'

export type Iconic20CheckerCandidate = {
  key: string
  externalKey: string
  name: string
  sport: Sport
  season: string
  source: Iconic20CheckerCandidateSource
  card?: PlayerCard
  profile?: CatalogImportProfile
}

export function iconic20OwnedSelectionKey(externalKey: string): string {
  return `owned:${externalKey}`
}

export function iconic20CatalogSelectionKey(externalKey: string): string {
  return `catalog:${externalKey}`
}

export function ownedCardToIconic20CheckerCandidate(
  card: PlayerCard,
): Iconic20CheckerCandidate | null {
  if (!card.externalKey || !isIconicBelowLevel(card.rarityLabel, 20)) return null
  return {
    key: iconic20OwnedSelectionKey(card.externalKey),
    externalKey: card.externalKey,
    name: card.name,
    sport: card.sport,
    season: card.season,
    source: 'owned',
    card,
  }
}

export function catalogProfileToIconic20CheckerCandidate(
  profile: CatalogImportProfile,
): Iconic20CheckerCandidate | null {
  if (profile.rows.length === 0) return null
  return {
    key: iconic20CatalogSelectionKey(profile.externalKey),
    externalKey: profile.externalKey,
    name: profile.name,
    sport: sportFromCatalog(profile.sport),
    season: profile.seasonLabel.trim() || String(profile.seasonYear),
    source: 'catalog',
    profile,
  }
}

function resolveCheckerCandidateRarity(
  candidate: Iconic20CheckerCandidate,
  fallbackRarity: string,
): string {
  const fromProfile = candidate.profile?.rarityLabel?.trim()
  if (fromProfile) return fromProfile
  return fallbackRarity.trim() || RECOMMENDATION_SIMULATED_RARITY
}

function applySimulatedRarityCheckerCandidate(
  data: RaxTrackerData,
  candidate: Iconic20CheckerCandidate,
  simulatedRarity: string,
): RaxTrackerData {
  if (candidate.source === 'owned' && candidate.card) {
    return applyOwnedCardRarityUpgrade(data, candidate.card, simulatedRarity)
  }
  if (candidate.source === 'catalog' && candidate.profile?.rows.length) {
    return addProfileToDataAtRarity(data, candidate.profile, simulatedRarity)
  }
  return data
}

function analyzeCheckerImpactsWithRarityResolver(
  data: RaxTrackerData,
  candidates: Iconic20CheckerCandidate[],
  resolveRarity: (candidate: Iconic20CheckerCandidate) => string,
): OwnedIconicUpgradeImpactResult {
  const eligible = candidates.filter(
    (candidate) =>
      (candidate.source === 'owned' && candidate.card) ||
      (candidate.source === 'catalog' && candidate.profile?.rows.length),
  )
  if (eligible.length === 0) {
    return {
      rows: [],
      combinedNetDelta: 0,
      combinedGuaranteedNetDelta: 0,
      combinedIsolatedNetDelta: 0,
    }
  }

  const isolatedByKey = new Map<string, number>()
  const passClaimableByKey = new Map<string, { claimable: number; guaranteed: number }>()
  for (const candidate of eligible) {
    const rarity = resolveRarity(candidate)
    const upgraded = applySimulatedRarityCheckerCandidate(data, candidate, rarity)
    const before = collectionClaimableTotal(data)
    const after = collectionClaimableTotal(upgraded)
    isolatedByKey.set(candidate.key, after - before)
    const cardId = findCardIdForCandidate(upgraded, candidate)
    if (cardId) {
      passClaimableByKey.set(candidate.key, cardClaimableTotals(upgraded, cardId))
    }
  }

  const bySport = new Map<Sport, Iconic20CheckerCandidate[]>()
  for (const candidate of eligible) {
    const list = bySport.get(candidate.sport) ?? []
    list.push(candidate)
    bySport.set(candidate.sport, list)
  }

  const rows: OwnedIconicUpgradeImpactRow[] = []
  let workingData = data
  for (const sport of [...bySport.keys()].sort()) {
    const ordered = [...(bySport.get(sport) ?? [])].sort(
      (a, b) => (isolatedByKey.get(b.key) ?? 0) - (isolatedByKey.get(a.key) ?? 0),
    )
    for (const candidate of ordered) {
      const before = collectionClaimableTotal(workingData)
      workingData = applySimulatedRarityCheckerCandidate(
        workingData,
        candidate,
        resolveRarity(candidate),
      )
      const after = collectionClaimableTotal(workingData)
      rows.push({
        key: candidate.key,
        name: candidate.name,
        sport: candidate.sport,
        season: candidate.season,
        ...impactIdentityFromCandidate(candidate),
        isolatedNetDelta: isolatedByKey.get(candidate.key) ?? 0,
        marginalNetDelta: after - before,
        passClaimableRax: passClaimableByKey.get(candidate.key)?.claimable ?? 0,
        passGuaranteedRax: passClaimableByKey.get(candidate.key)?.guaranteed ?? 0,
      })
    }
  }

  const combined = collectionNetDeltas(data, workingData)

  return {
    rows,
    combinedNetDelta: combined.withPro,
    combinedGuaranteedNetDelta: combined.guaranteed,
    combinedIsolatedNetDelta: [...isolatedByKey.values()].reduce((sum, value) => sum + value, 0),
  }
}

export function analyzeSimulatedRarityCheckerImpacts(
  data: RaxTrackerData,
  candidates: Iconic20CheckerCandidate[],
  simulatedRarity: string,
): OwnedIconicUpgradeImpactResult {
  return analyzeCheckerImpactsWithRarityResolver(data, candidates, () => simulatedRarity)
}

export function analyzeIconic20CheckerImpacts(
  data: RaxTrackerData,
  candidates: Iconic20CheckerCandidate[],
): OwnedIconicUpgradeImpactResult {
  return analyzeSimulatedRarityCheckerImpacts(data, candidates, ICONIC_20_SIMULATED_RARITY)
}

export function analyzeCatalogBundleImpacts(
  data: RaxTrackerData,
  profiles: CatalogImportProfile[],
  simulatedRarity: string = RECOMMENDATION_SIMULATED_RARITY,
): OwnedIconicUpgradeImpactResult {
  const candidates = profiles
    .map(catalogProfileToIconic20CheckerCandidate)
    .filter((candidate): candidate is Iconic20CheckerCandidate => candidate !== null)
  return analyzeSimulatedRarityCheckerImpacts(data, candidates, simulatedRarity)
}

/** Bundle impacts using each profile's own `rarityLabel` (Plan page mixed rarities). */
export function analyzeCatalogBundleImpactsAtProfileRarities(
  data: RaxTrackerData,
  profiles: CatalogImportProfile[],
): OwnedIconicUpgradeImpactResult {
  const candidates = profiles
    .map(catalogProfileToIconic20CheckerCandidate)
    .filter((candidate): candidate is Iconic20CheckerCandidate => candidate !== null)
  return analyzeCheckerImpactsWithRarityResolver(data, candidates, (candidate) =>
    resolveCheckerCandidateRarity(candidate, RECOMMENDATION_SIMULATED_RARITY),
  )
}

function rankCandidatesSync(
  data: RaxTrackerData,
  candidates: CatalogImportProfile[],
): PassRecommendationRow[] {
  const rows: PassRecommendationRow[] = []
  for (const profile of candidates) {
    const row = analyzeCatalogCandidate(data, profile)
    if (row) rows.push(row)
  }
  return sortRecommendationRows(rows)
}

function rankMonthCandidatesSync(
  data: RaxTrackerData,
  candidates: CatalogImportProfile[],
  monthIdx: number,
): MonthPassRecommendationRow[] {
  const rows: MonthPassRecommendationRow[] = []
  for (const profile of candidates) {
    const row = analyzeCatalogCandidateForMonth(data, profile, monthIdx)
    if (row) rows.push(row)
  }
  return sortMonthRecommendationRows(rows)
}

function rankDayCandidatesSync(
  data: RaxTrackerData,
  candidates: CatalogImportProfile[],
  monthDay: string,
): MonthPassRecommendationRow[] {
  const rows: MonthPassRecommendationRow[] = []
  for (const profile of candidates) {
    const row = analyzeCatalogCandidateForDay(data, profile, monthDay)
    if (row) rows.push(row)
  }
  return sortMonthRecommendationRows(rows)
}

async function rankCandidatesAsync(
  data: RaxTrackerData,
  candidates: CatalogImportProfile[],
  options?: {
    onProgress?: (progress: PassRecommendationProgress) => void
    signal?: AbortSignal
    batchSize?: number
    progressLabel?: string
  },
): Promise<PassRecommendationRow[]> {
  const rows: PassRecommendationRow[] = []
  const batchSize = Math.max(options?.batchSize ?? 24, 1)

  for (let index = 0; index < candidates.length; index += batchSize) {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const batch = candidates.slice(index, index + batchSize)
    for (const profile of batch) {
      const row = analyzeCatalogCandidate(data, profile)
      if (row) rows.push(row)
    }

    const current = Math.min(index + batch.length, candidates.length)
    options?.onProgress?.({
      current,
      total: candidates.length,
      label: options.progressLabel
        ? `${options.progressLabel}: ${batch[batch.length - 1]?.name || 'Finishing…'}`
        : batch[batch.length - 1]?.name || 'Finishing…',
    })
    await yieldToMain()
  }

  return sortRecommendationRows(rows)
}

async function rankMonthCandidatesAsync(
  data: RaxTrackerData,
  candidates: CatalogImportProfile[],
  monthIdx: number,
  options?: {
    onProgress?: (progress: PassRecommendationProgress) => void
    signal?: AbortSignal
    batchSize?: number
    progressLabel?: string
  },
): Promise<MonthPassRecommendationRow[]> {
  const rows: MonthPassRecommendationRow[] = []
  const batchSize = Math.max(options?.batchSize ?? 24, 1)

  for (let index = 0; index < candidates.length; index += batchSize) {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const batch = candidates.slice(index, index + batchSize)
    for (const profile of batch) {
      const row = analyzeCatalogCandidateForMonth(data, profile, monthIdx)
      if (row) rows.push(row)
    }

    const current = Math.min(index + batch.length, candidates.length)
    options?.onProgress?.({
      current,
      total: candidates.length,
      label: options.progressLabel
        ? `${options.progressLabel}: ${batch[batch.length - 1]?.name || 'Finishing…'}`
        : batch[batch.length - 1]?.name || 'Finishing…',
    })
    await yieldToMain()
  }

  return sortMonthRecommendationRows(rows)
}

async function rankDayCandidatesAsync(
  data: RaxTrackerData,
  candidates: CatalogImportProfile[],
  monthDay: string,
  options?: {
    onProgress?: (progress: PassRecommendationProgress) => void
    signal?: AbortSignal
    batchSize?: number
    progressLabel?: string
  },
): Promise<MonthPassRecommendationRow[]> {
  const rows: MonthPassRecommendationRow[] = []
  const batchSize = Math.max(options?.batchSize ?? 24, 1)

  for (let index = 0; index < candidates.length; index += batchSize) {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const batch = candidates.slice(index, index + batchSize)
    for (const profile of batch) {
      const row = analyzeCatalogCandidateForDay(data, profile, monthDay)
      if (row) rows.push(row)
    }

    const current = Math.min(index + batch.length, candidates.length)
    options?.onProgress?.({
      current,
      total: candidates.length,
      label: options.progressLabel
        ? `${options.progressLabel}: ${batch[batch.length - 1]?.name || 'Finishing…'}`
        : batch[batch.length - 1]?.name || 'Finishing…',
    })
    await yieldToMain()
  }

  return sortMonthRecommendationRows(rows)
}

function pickGreedyBundle(
  data: RaxTrackerData,
  analysisPool: CatalogImportProfile[],
  candidateByKey: Map<string, CatalogImportProfile>,
  pickCount: number,
): PassRecommendationBundle {
  let workingData = data
  const picks: PassRecommendationRow[] = []
  const pickedKeys = new Set<string>()

  for (let pickIndex = 0; pickIndex < pickCount; pickIndex += 1) {
    const remainingProfiles = analysisPool.filter((profile) => !pickedKeys.has(profile.externalKey))
    if (remainingProfiles.length === 0) break

    const ranked = rankCandidatesSync(workingData, remainingProfiles)
    const best = ranked[0]
    if (!best || best.netClaimableDelta <= 0) break

    picks.push(best)
    pickedKeys.add(best.externalKey)
    const profile = candidateByKey.get(best.externalKey)
    if (!profile) break
    workingData = addProfileToData(workingData, profile)
  }

  return {
    picks,
    combinedNetDelta: picks.reduce((sum, row) => sum + row.netClaimableDelta, 0),
  }
}

async function pickGreedyBundleAsync(
  data: RaxTrackerData,
  analysisPool: CatalogImportProfile[],
  candidateByKey: Map<string, CatalogImportProfile>,
  pickCount: number,
  options?: {
    onProgress?: (progress: PassRecommendationProgress) => void
    signal?: AbortSignal
    batchSize?: number
  },
): Promise<PassRecommendationBundle> {
  let workingData = data
  const picks: PassRecommendationRow[] = []
  const pickedKeys = new Set<string>()

  for (let pickIndex = 0; pickIndex < pickCount; pickIndex += 1) {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const remainingProfiles = analysisPool.filter((profile) => !pickedKeys.has(profile.externalKey))
    if (remainingProfiles.length === 0) break

    const reranked = await rankCandidatesAsync(workingData, remainingProfiles, {
      ...options,
      progressLabel:
        pickIndex === 0
          ? 'Ranking'
          : `Bundle pick ${pickIndex + 1}/${pickCount}`,
    })
    const best = reranked[0]
    if (!best || best.netClaimableDelta <= 0) break

    picks.push(best)
    pickedKeys.add(best.externalKey)
    const profile = candidateByKey.get(best.externalKey)
    if (!profile) break
    workingData = addProfileToData(workingData, profile)
  }

  return {
    picks,
    combinedNetDelta: picks.reduce((sum, row) => sum + row.netClaimableDelta, 0),
  }
}

export function rankCatalogRecommendations(
  data: RaxTrackerData,
  profiles: CatalogImportProfile[],
  options?: RecommendationFilterOptions & { analysisCap?: number },
): PassRecommendationResult {
  const { candidates, skippedOwnedIconic, skippedNoRows, skippedAdjusted } = filterRecommendationProfiles(
    data,
    profiles,
    options,
  )
  const { profiles: analysisPool, trimmed } = prefilterRecommendationProfiles(
    candidates,
    options?.analysisCap ?? RECOMMENDATION_ANALYSIS_CAP,
  )
  const rows = rankCandidatesSync(data, analysisPool)

  return {
    rows,
    skippedOwnedIconic,
    skippedNoRows,
    skippedAdjusted,
    analyzedCount: rows.length,
    prefilterTrimmed: trimmed,
  }
}

export async function rankCatalogRecommendationsAsync(
  data: RaxTrackerData,
  profiles: CatalogImportProfile[],
  options?: RecommendationFilterOptions & {
    analysisCap?: number
    onProgress?: (progress: PassRecommendationProgress) => void
    signal?: AbortSignal
    batchSize?: number
  },
): Promise<PassRecommendationResult> {
  const { candidates, skippedOwnedIconic, skippedNoRows, skippedAdjusted } = filterRecommendationProfiles(
    data,
    profiles,
    options,
  )
  const { profiles: analysisPool, trimmed } = prefilterRecommendationProfiles(
    candidates,
    options?.analysisCap ?? RECOMMENDATION_ANALYSIS_CAP,
  )
  const rows = await rankCandidatesAsync(data, analysisPool, options)

  return {
    rows,
    skippedOwnedIconic,
    skippedNoRows,
    skippedAdjusted,
    analyzedCount: rows.length,
    prefilterTrimmed: trimmed,
  }
}

export function rankCatalogRecommendationsForMonth(
  data: RaxTrackerData,
  profiles: CatalogImportProfile[],
  monthIdx: number,
  options?: RecommendationFilterOptions & { analysisCap?: number },
): MonthPassRecommendationResult {
  const { candidates, skippedOwnedIconic, skippedNoRows, skippedAdjusted } = filterRecommendationProfiles(
    data,
    profiles,
    options,
  )
  const { profiles: analysisPool, trimmed } = prefilterRecommendationProfiles(
    candidates,
    options?.analysisCap ?? RECOMMENDATION_ANALYSIS_CAP,
  )
  const rows = rankMonthCandidatesSync(data, analysisPool, monthIdx)

  return {
    rows,
    skippedOwnedIconic,
    skippedNoRows,
    skippedAdjusted,
    analyzedCount: rows.length,
    prefilterTrimmed: trimmed,
    monthIdx,
    month: CALENDAR_MONTH_NAMES[monthIdx] ?? 'Other',
  }
}

export async function rankCatalogRecommendationsForMonthAsync(
  data: RaxTrackerData,
  profiles: CatalogImportProfile[],
  monthIdx: number,
  options?: RecommendationFilterOptions & {
    analysisCap?: number
    onProgress?: (progress: PassRecommendationProgress) => void
    signal?: AbortSignal
    batchSize?: number
  },
): Promise<MonthPassRecommendationResult> {
  const { candidates, skippedOwnedIconic, skippedNoRows, skippedAdjusted } = filterRecommendationProfiles(
    data,
    profiles,
    options,
  )
  const { profiles: analysisPool, trimmed } = prefilterRecommendationProfiles(
    candidates,
    options?.analysisCap ?? RECOMMENDATION_ANALYSIS_CAP,
  )
  const rows = await rankMonthCandidatesAsync(data, analysisPool, monthIdx, options)

  return {
    rows,
    skippedOwnedIconic,
    skippedNoRows,
    skippedAdjusted,
    analyzedCount: rows.length,
    prefilterTrimmed: trimmed,
    monthIdx,
    month: CALENDAR_MONTH_NAMES[monthIdx] ?? 'Other',
  }
}

export function rankCatalogRecommendationsForDay(
  data: RaxTrackerData,
  profiles: CatalogImportProfile[],
  claimDay: string,
  options?: RecommendationFilterOptions & { analysisCap?: number },
): MonthPassRecommendationResult {
  const monthDay = normalizeBestDayParam(claimDay)
  if (!monthDay) {
    return {
      rows: [],
      skippedOwnedIconic: 0,
      skippedNoRows: 0,
      skippedAdjusted: 0,
      analyzedCount: 0,
      prefilterTrimmed: 0,
      monthIdx: -1,
      month: 'Day',
      claimDay: undefined,
    }
  }

  const { candidates, skippedOwnedIconic, skippedNoRows, skippedAdjusted } = filterRecommendationProfiles(
    data,
    profiles,
    options,
  )
  const {
    profiles: analysisPool,
    trimmed,
    skippedNoDayRows,
  } = prefilterRecommendationProfilesForDay(
    candidates,
    monthDay,
    options?.analysisCap ?? RECOMMENDATION_ANALYSIS_CAP,
  )
  const rows = rankDayCandidatesSync(data, analysisPool, monthDay)
  const monthIdx = monthIndexFromMonthDay(monthDay)

  return {
    rows,
    skippedOwnedIconic,
    skippedNoRows: skippedNoRows + skippedNoDayRows,
    skippedAdjusted,
    analyzedCount: rows.length,
    prefilterTrimmed: trimmed,
    monthIdx,
    month: formatClaimDay(monthDay),
    claimDay: monthDay,
  }
}

export async function rankCatalogRecommendationsForDayAsync(
  data: RaxTrackerData,
  profiles: CatalogImportProfile[],
  claimDay: string,
  options?: RecommendationFilterOptions & {
    analysisCap?: number
    onProgress?: (progress: PassRecommendationProgress) => void
    signal?: AbortSignal
    batchSize?: number
  },
): Promise<MonthPassRecommendationResult> {
  const monthDay = normalizeBestDayParam(claimDay)
  if (!monthDay) {
    return {
      rows: [],
      skippedOwnedIconic: 0,
      skippedNoRows: 0,
      skippedAdjusted: 0,
      analyzedCount: 0,
      prefilterTrimmed: 0,
      monthIdx: -1,
      month: 'Day',
      claimDay: undefined,
    }
  }

  const { candidates, skippedOwnedIconic, skippedNoRows, skippedAdjusted } = filterRecommendationProfiles(
    data,
    profiles,
    options,
  )
  const {
    profiles: analysisPool,
    trimmed,
    skippedNoDayRows,
  } = prefilterRecommendationProfilesForDay(
    candidates,
    monthDay,
    options?.analysisCap ?? RECOMMENDATION_ANALYSIS_CAP,
  )
  const rows = await rankDayCandidatesAsync(data, analysisPool, monthDay, options)
  const monthIdx = monthIndexFromMonthDay(monthDay)

  return {
    rows,
    skippedOwnedIconic,
    skippedNoRows: skippedNoRows + skippedNoDayRows,
    skippedAdjusted,
    analyzedCount: rows.length,
    prefilterTrimmed: trimmed,
    monthIdx,
    month: formatClaimDay(monthDay),
    claimDay: monthDay,
  }
}

export async function rankAndRecommendAsync(
  data: RaxTrackerData,
  profiles: CatalogImportProfile[],
  bundleSize: number,
  options?: RecommendationFilterOptions & {
    sport?: Sport
    caps?: RecommendationCaps
    onProgress?: (progress: PassRecommendationProgress) => void
    signal?: AbortSignal
    batchSize?: number
  },
): Promise<RankAndRecommendResult> {
  const caps =
    options?.caps ?? (options?.sport ? recommendationCapsForSport(options.sport) : null)
  const analysisCap = caps?.analysisCap ?? RECOMMENDATION_ANALYSIS_CAP

  const { candidates, skippedOwnedIconic, skippedNoRows, skippedAdjusted } = filterRecommendationProfiles(
    data,
    profiles,
    options,
  )
  const { profiles: analysisPool, trimmed } = prefilterRecommendationProfiles(
    candidates,
    analysisCap,
  )
  const candidateByKey = new Map(candidates.map((profile) => [profile.externalKey, profile]))

  const rankedRows = await rankCandidatesAsync(data, analysisPool, {
    ...options,
    progressLabel: 'Ranking',
  })

  const pickCount = Math.max(0, Math.min(Math.floor(bundleSize), RECOMMENDATION_MAX_BUNDLE_SIZE))

  const bundle = await pickGreedyBundleAsync(
    data,
    analysisPool,
    candidateByKey,
    pickCount,
    {
      onProgress: options?.onProgress,
      signal: options?.signal,
      batchSize: options?.batchSize,
    },
  )

  return {
    ranked: {
      rows: rankedRows,
      skippedOwnedIconic,
      skippedNoRows,
      skippedAdjusted,
      analyzedCount: rankedRows.length,
      prefilterTrimmed: trimmed,
    },
    bundle,
  }
}

export async function greedyPickBundleAsync(
  data: RaxTrackerData,
  profiles: CatalogImportProfile[],
  count: number,
  options?: RecommendationFilterOptions & {
    onProgress?: (progress: PassRecommendationProgress) => void
    signal?: AbortSignal
    batchSize?: number
  },
): Promise<PassRecommendationBundle> {
  const result = await rankAndRecommendAsync(data, profiles, count, options)
  return result.bundle
}

export function greedyPickBundle(
  data: RaxTrackerData,
  profiles: CatalogImportProfile[],
  count: number,
  options?: RecommendationFilterOptions,
): PassRecommendationBundle {
  const pickCount = Math.max(0, Math.min(Math.floor(count), RECOMMENDATION_MAX_BUNDLE_SIZE))
  if (pickCount === 0) {
    return { picks: [], combinedNetDelta: 0 }
  }

  const { candidates } = filterRecommendationProfiles(data, profiles, options)
  const { profiles: analysisPool } = prefilterRecommendationProfiles(candidates)
  const candidateByKey = new Map(candidates.map((profile) => [profile.externalKey, profile]))

  return pickGreedyBundle(data, analysisPool, candidateByKey, pickCount)
}

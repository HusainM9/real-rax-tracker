import type { CatalogImportProfile } from './catalogApi'
import type { CatalogSearchResult } from './catalogApi'
import { catalogProfileToJson } from './catalogProfileJson'
import { sportFromCatalog, importCatalogProfileIntoData } from './catalogImport'
import { analyzePotentialCard, type PotentialAnalysisResult } from './potentialAnalysis'
import { parseRealAppToolsRows, type ParsedRealAppToolsRow } from './realAppToolsImport'
import { computeOtdRax } from './otdRax'
import { normalizeRarityTier } from './rarityFilter'
import type { CatalogPassKind } from './catalogApi'
import { SPORTS, type RaxTrackerData, type Sport } from '../types/rax'

/** All recommendation what-if runs assume buying at this OTD tier. */
export const RECOMMENDATION_SIMULATED_RARITY = 'Iconic 1'

/** Default max catalog passes to fetch full daily rows for (sorted by base RAX). */
export const RECOMMENDATION_BULK_FETCH_CAP = 1000

/** Default max passes to run full claim simulation on per ranking pass. */
export const RECOMMENDATION_ANALYSIS_CAP = 400

/** Max candidates re-analyzed per greedy bundle pick after the first. */
export const RECOMMENDATION_GREEDY_RERANK_CAP = 80

/** Max passes in a greedy recommended bundle. */
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
  totalBaseRax: number
  iconic1TotalRax: number
  rowCount: number
  newClaimableRax: number
  displacedRax: number
  overlapRax: number
  netClaimableDelta: number
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

export function applyRecommendationBaseline(
  data: RaxTrackerData,
  profilesByKey: Map<string, CatalogImportProfile>,
  adjustments?: RecommendationPassAdjustment[],
): RaxTrackerData {
  const { assumeIconic1 } = getRecommendationAdjustmentSets(adjustments)
  let workingData = data
  for (const externalKey of assumeIconic1) {
    const profile = profilesByKey.get(externalKey)
    if (!profile || profile.rows.length === 0) continue
    workingData = addProfileToData(workingData, profile)
  }
  return workingData
}

export function shouldSkipRecommendationPass(
  data: RaxTrackerData,
  externalKey: string,
  adjustments?: RecommendationPassAdjustment[],
): boolean {
  const { assumeIconic1, excluded } = getRecommendationAdjustmentSets(adjustments)
  if (excluded.has(externalKey) || assumeIconic1.has(externalKey)) return true

  const owned = data.cards.find((card) => card.externalKey === externalKey)
  if (!owned) return false
  return isAtLeastIconic1Rarity(owned.rarityLabel)
}

export function netClaimableDelta(result: PotentialAnalysisResult): number {
  return result.claimableRax - result.displacedRax
}

export function estimateIconic1TotalRax(profile: CatalogImportProfile): number {
  const sport = sportFromCatalog(profile.sport)
  return profile.rows.reduce(
    (sum, row) =>
      sum + computeOtdRax(row.baseRaxEarned, sport, RECOMMENDATION_SIMULATED_RARITY, profile.passKind),
    0,
  )
}

export function catalogProfileToParsedRows(profile: CatalogImportProfile): ParsedRealAppToolsRow[] {
  const sport = sportFromCatalog(profile.sport)
  const rawJson = catalogProfileToJson(profile)
  const parsed = parseRealAppToolsRows(rawJson, {
    sport,
    passKind: profile.passKind,
    applyOtdMultiplier: false,
  })
  return parsed.rows
}

export function profileAsIconic1(profile: CatalogImportProfile): CatalogImportProfile {
  return { ...profile, rarityLabel: RECOMMENDATION_SIMULATED_RARITY }
}

export type RecommendationPassAdjustmentMode = 'assume-iconic-1' | 'exclude'

export type RecommendationPassAdjustment = {
  externalKey: string
  name: string
  sport: Sport
  season: string
  mode: RecommendationPassAdjustmentMode
}

export type RecommendationSeasonFilter = {
  /** Keys like `NFL|2022-23` — excludes that sport+season pair only. */
  excludedSportSeasonKeys?: string[]
}

export type RecommendationFilterOptions = RecommendationSeasonFilter & {
  adjustments?: RecommendationPassAdjustment[]
}

export function seasonLabelForFilter(item: { seasonLabel: string; seasonYear: number }): string {
  const label = item.seasonLabel.trim()
  return label || String(item.seasonYear)
}

export function sportSeasonFilterKey(sport: Sport, seasonLabel: string): string {
  return `${sport}|${seasonLabel}`
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
  const { excluded, assumeIconic1 } = getRecommendationAdjustmentSets(options?.adjustments)

  for (const profile of profiles) {
    if (excluded.has(profile.externalKey) || assumeIconic1.has(profile.externalKey)) {
      skippedAdjusted += 1
      continue
    }
    if (shouldSkipRecommendationPass(data, profile.externalKey, options?.adjustments)) {
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

  for (const summary of summaries) {
    if (summary.rowCount <= 0) continue
    if (!passSeasonIncluded(summary, options?.excludedSportSeasonKeys)) continue
    const { excluded, assumeIconic1 } = getRecommendationAdjustmentSets(options?.adjustments)
    if (excluded.has(summary.externalKey) || assumeIconic1.has(summary.externalKey)) {
      skippedAdjusted += 1
      continue
    }
    if (shouldSkipRecommendationPass(data, summary.externalKey, options?.adjustments)) {
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
  if (profile.rows.length === 0) return null

  const rows = catalogProfileToParsedRows(profile)
  if (rows.length === 0) return null

  const sport = sportFromCatalog(profile.sport)
  const analysis = analyzePotentialCard(
    data,
    {
      name: profile.name,
      sport,
      season: profile.seasonLabel || String(profile.seasonYear),
      simulatedRarityLabel: RECOMMENDATION_SIMULATED_RARITY,
      passKind: profile.passKind,
    },
    rows,
  )
  if (!analysis) return null

  return {
    externalKey: profile.externalKey,
    name: profile.name,
    sport,
    season: profile.seasonLabel || String(profile.seasonYear),
    seasonYear: profile.seasonYear,
    rarityLabel: RECOMMENDATION_SIMULATED_RARITY,
    passKind: profile.passKind,
    totalBaseRax: profile.totalBaseRax,
    iconic1TotalRax: estimateIconic1TotalRax(profile),
    rowCount: profile.rows.length,
    newClaimableRax: analysis.claimableRax,
    displacedRax: analysis.displacedRax,
    overlapRax: analysis.overlapRax,
    netClaimableDelta: netClaimableDelta(analysis),
  }
}

function sortRecommendationRows(rows: PassRecommendationRow[]): PassRecommendationRow[] {
  return [...rows].sort(
    (a, b) =>
      b.netClaimableDelta - a.netClaimableDelta ||
      b.newClaimableRax - a.newClaimableRax ||
      a.name.localeCompare(b.name),
  )
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
  const greedyRerankCap = caps?.greedyRerankCap ?? RECOMMENDATION_GREEDY_RERANK_CAP

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
  const picks: PassRecommendationRow[] = []
  let workingData = data
  const pickedKeys = new Set<string>()

  for (let pickIndex = 0; pickIndex < pickCount; pickIndex += 1) {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    let best: PassRecommendationRow | undefined
    if (pickIndex === 0) {
      best = rankedRows.find((row) => !pickedKeys.has(row.externalKey))
    } else {
      const remainingProfiles = candidates.filter(
        (profile) => !pickedKeys.has(profile.externalKey),
      )
      const { profiles: rerankPool } = prefilterRecommendationProfiles(
        remainingProfiles,
        greedyRerankCap,
      )
      const reranked = await rankCandidatesAsync(workingData, rerankPool, {
        ...options,
        progressLabel: `Bundle pick ${pickIndex + 1}/${pickCount}`,
      })
      best = reranked[0]
    }

    if (!best || best.netClaimableDelta <= 0) break

    picks.push(best)
    pickedKeys.add(best.externalKey)
    const profile = candidateByKey.get(best.externalKey)
    if (!profile) break
    workingData = addProfileToData(workingData, profile)
  }

  return {
    ranked: {
      rows: rankedRows,
      skippedOwnedIconic,
      skippedNoRows,
      skippedAdjusted,
      analyzedCount: rankedRows.length,
      prefilterTrimmed: trimmed,
    },
    bundle: {
      picks,
      combinedNetDelta: picks.reduce((sum, row) => sum + row.netClaimableDelta, 0),
    },
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

  let workingData = data
  const picks: PassRecommendationRow[] = []
  const pickedKeys = new Set<string>()

  for (let pickIndex = 0; pickIndex < pickCount; pickIndex += 1) {
    const remainingProfiles = candidates.filter((profile) => !pickedKeys.has(profile.externalKey))
    if (remainingProfiles.length === 0) break

    const pool =
      pickIndex === 0
        ? analysisPool.filter((profile) => !pickedKeys.has(profile.externalKey))
        : prefilterRecommendationProfiles(remainingProfiles, RECOMMENDATION_GREEDY_RERANK_CAP)
            .profiles

    const ranked = rankCandidatesSync(workingData, pool)
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

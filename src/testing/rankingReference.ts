/** Full-collection oracle for tests/benchmarks only. Never imported by application routes. */
import { dedupeCatalogPassSummaries } from '../../lib/catalogPassIdentity'
import { computeYearRollup } from '../lib/claimOptimizer'
import { sportFromCatalog } from '../lib/catalogImport'
import {
  addProfileToDataAtRarity, estimateIconic1TotalRax, filterRecommendationProfiles,
  prefilterRecommendationProfiles, recommendationPassKind,
  type PassRecommendationRow, type RecommendationFilterOptions, type RankAndRecommendResult,
} from '../lib/passRecommendation'
import type { CatalogImportProfile } from '../lib/catalogApi'
import type { RaxTrackerData } from '../types/rax'

export function rankProfilesReference(data: RaxTrackerData, profiles: CatalogImportProfile[]): PassRecommendationRow[] {
  const pro = { ...data, settings: { ...data.settings, proBonusEnabled: true } }
  const baseline = computeYearRollup(pro)
  const rows = profiles.filter((profile) => profile.rows.length).map((profile): PassRecommendationRow => {
    const after = computeYearRollup(addProfileToDataAtRarity(pro, profile, 'Iconic 1'))
    const target = after.cards.find((row) => row.card.externalKey === profile.externalKey)!
    const netClaimableDelta = after.totalClaimableRax - baseline.totalClaimableRax
    return {
      externalKey: profile.externalKey, name: profile.name, sport: sportFromCatalog(profile.sport),
      season: profile.seasonLabel || String(profile.seasonYear), seasonYear: profile.seasonYear,
      rarityLabel: 'Iconic 1', passKind: recommendationPassKind(profile), avatar: profile.avatar,
      totalBaseRax: profile.totalBaseRax, iconic1TotalRax: estimateIconic1TotalRax(profile), rowCount: profile.rows.length,
      newClaimableRax: target.totalClaimableRax, overlapRax: target.overlapRax,
      displacedRax: Math.max(0, target.totalClaimableRax - netClaimableDelta),
      netClaimableDelta, netGuaranteedDelta: after.totalGuaranteedRax - baseline.totalGuaranteedRax,
    }
  }).sort((a, b) => b.netClaimableDelta - a.netClaimableDelta || b.newClaimableRax - a.newClaimableRax || a.name.localeCompare(b.name))
  return dedupeCatalogPassSummaries(rows).items
}

export function rankAndRecommendReference(
  data: RaxTrackerData,
  profiles: CatalogImportProfile[],
  count: number,
  options: RecommendationFilterOptions & { analysisCap: number },
  onPick?: (count: number, elapsedMs: number) => void,
): RankAndRecommendResult {
  const started = performance.now()
  const { candidates, ...skipped } = filterRecommendationProfiles(data, profiles, options)
  const { profiles: pool, trimmed } = prefilterRecommendationProfiles(candidates, options.analysisCap)
  const rows = rankProfilesReference(data, pool)
  onPick?.(0, performance.now() - started)
  let working = data
  const picks: PassRecommendationRow[] = []
  const picked = new Set<string>()
  for (let index = 0; index < Math.min(20, Math.max(0, Math.floor(count))); index++) {
    const remaining = pool.filter((profile) => !picked.has(profile.externalKey))
    const best = (index === 0 ? rows : rankProfilesReference(working, remaining))[0]
    if (!best || best.netClaimableDelta <= 0) break
    picks.push(best)
    picked.add(best.externalKey)
    working = addProfileToDataAtRarity(working, candidates.find((profile) => profile.externalKey === best.externalKey)!, 'Iconic 1')
    onPick?.(picks.length, performance.now() - started)
  }
  return {
    ranked: { ...skipped, rows, analyzedCount: rows.length, prefilterTrimmed: trimmed },
    bundle: { picks, combinedNetDelta: picks.reduce((sum, row) => sum + row.netClaimableDelta, 0) },
  }
}

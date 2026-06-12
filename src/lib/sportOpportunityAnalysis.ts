import { computeYearRollup } from './claimOptimizer'
import type { PassRecommendationBundle, PassRecommendationResult } from './passRecommendation'
import { SPORTS, type RaxTrackerData, type Sport } from '../types/rax'

/** Greedy picks per sport in the opportunity scan. */
export const SPORT_OPPORTUNITY_BUNDLE_SIZE = 5

/** Catalog summaries loaded per sport before earnings fetch. */
export const SPORT_OPPORTUNITY_SUMMARY_LIMIT = 250

/** Max passes to fetch full earnings for per sport in the scan. */
export const SPORT_OPPORTUNITY_FETCH_CAP = 150

/** Max passes to simulate per sport in the scan. */
export const SPORT_OPPORTUNITY_ANALYSIS_CAP = 80

export type SportCollectionStats = {
  ownedCards: number
  currentClaimableRax: number
  overlapRax: number
}

export type SportOpportunityRow = {
  sport: Sport
  ownedCards: number
  currentClaimableRax: number
  overlapRax: number
  /** Combined net from a greedy top-N bundle at Iconic 1. */
  greedyCombinedNet: number
  greedyPickCount: number
  greedyPickLabels: string[]
  /** Best solo net pass in the analyzed pool. */
  bestSingleNet: number
  bestSinglePassLabel: string | null
  catalogPassesScreened: number
  candidatesAnalyzed: number
}

export function formatSportOpportunityPickLabel(name: string, season: string): string {
  const seasonLabel = season.trim()
  return seasonLabel ? `${name} · ${seasonLabel}` : name
}

export function computeSportCollectionStats(data: RaxTrackerData): Map<Sport, SportCollectionStats> {
  const rollup = computeYearRollup(data)
  const rollupBySport = new Map(rollup.sports.map((entry) => [entry.sport, entry]))
  const stats = new Map<Sport, SportCollectionStats>()

  for (const sport of SPORTS) {
    const sportRollup = rollupBySport.get(sport)
    stats.set(sport, {
      ownedCards: data.cards.filter((card) => card.sport === sport).length,
      currentClaimableRax: sportRollup?.totalClaimableRax ?? 0,
      overlapRax: sportRollup?.overlapRax ?? 0,
    })
  }

  return stats
}

export function buildSportOpportunityRow(
  sport: Sport,
  collection: SportCollectionStats,
  catalogPassesScreened: number,
  ranked: PassRecommendationResult,
  bundle: PassRecommendationBundle,
): SportOpportunityRow {
  const bestSingle = ranked.rows[0]

  return {
    sport,
    ownedCards: collection.ownedCards,
    currentClaimableRax: collection.currentClaimableRax,
    overlapRax: collection.overlapRax,
    greedyCombinedNet: bundle.combinedNetDelta,
    greedyPickCount: bundle.picks.length,
    greedyPickLabels: bundle.picks.map((pick) =>
      formatSportOpportunityPickLabel(pick.name, pick.season),
    ),
    bestSingleNet: bestSingle?.netClaimableDelta ?? 0,
    bestSinglePassLabel: bestSingle
      ? formatSportOpportunityPickLabel(bestSingle.name, bestSingle.season)
      : null,
    catalogPassesScreened,
    candidatesAnalyzed: ranked.analyzedCount,
  }
}

export function sortSportOpportunityRows(rows: SportOpportunityRow[]): SportOpportunityRow[] {
  return [...rows].sort(
    (a, b) =>
      b.greedyCombinedNet - a.greedyCombinedNet ||
      b.bestSingleNet - a.bestSingleNet ||
      a.sport.localeCompare(b.sport),
  )
}

export function topSportOpportunityFocus(rows: SportOpportunityRow[]): SportOpportunityRow | null {
  const sorted = sortSportOpportunityRows(rows)
  const top = sorted[0]
  if (!top || top.greedyCombinedNet <= 0) {
    return sorted.find((row) => row.bestSingleNet > 0) ?? null
  }
  return top
}

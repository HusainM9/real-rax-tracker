import type { CardRollup, ClaimCandidate, ClaimDayResult, Sport } from '../types/rax'

export type SportOverlapDay = {
  claimDay: string
  day: ClaimDayResult
  sport: Sport
  overlaps: ClaimCandidate[]
  sportOverlapRax: number
}

export function sportOverlapCandidates(
  day: ClaimDayResult,
  sport: Sport,
): ClaimCandidate[] {
  const sportResult = day.sports.find((row) => row.sport === sport)
  if (!sportResult) return []
  return sportResult.overlaps.filter((candidate) => candidate.status === 'overlap')
}

export function buildSportOverlapDay(day: ClaimDayResult, sport: Sport): SportOverlapDay | null {
  const overlaps = sportOverlapCandidates(day, sport)
  if (overlaps.length === 0) return null
  const sportOverlapRax = overlaps.reduce(
    (sum, candidate) => sum + candidate.performance.raxEarned,
    0,
  )
  return { claimDay: day.claimDay, day, sport, overlaps, sportOverlapRax }
}

export function getSportsWithOverlaps(results: ClaimDayResult[]): Sport[] {
  const sports = new Set<Sport>()
  for (const day of results) {
    for (const sportResult of day.sports) {
      if (sportResult.overlaps.some((candidate) => candidate.status === 'overlap')) {
        sports.add(sportResult.sport)
      }
    }
  }
  return [...sports].sort((a, b) => a.localeCompare(b))
}

export function listSportOverlapDays(
  results: ClaimDayResult[],
  sport: Sport,
): SportOverlapDay[] {
  return results
    .map((day) => buildSportOverlapDay(day, sport))
    .filter((row): row is SportOverlapDay => row !== null)
}

export function sortSportOverlapDays(days: SportOverlapDay[]): SportOverlapDay[] {
  return [...days].sort(
    (a, b) =>
      b.sportOverlapRax - a.sportOverlapRax || a.claimDay.localeCompare(b.claimDay),
  )
}

export function listAllOverlapDays(results: ClaimDayResult[]): SportOverlapDay[] {
  return sortSportOverlapDays(
    getSportsWithOverlaps(results).flatMap((sport) => listSportOverlapDays(results, sport)),
  )
}

export function filterAllOverlapCards(cards: CardRollup[]): CardRollup[] {
  return cards
    .filter((rollup) => rollup.overlapCount > 0)
    .sort((a, b) => b.overlapRax - a.overlapRax || a.card.name.localeCompare(b.card.name))
}

export function filterOverlapCardsBySport(cards: CardRollup[], sport: Sport): CardRollup[] {
  return cards
    .filter((rollup) => rollup.card.sport === sport && rollup.overlapCount > 0)
    .sort((a, b) => b.overlapRax - a.overlapRax || a.card.name.localeCompare(b.card.name))
}

export function sportOverlapTotals(days: SportOverlapDay[]): {
  dayCount: number
  totalOverlapRax: number
} {
  return {
    dayCount: days.length,
    totalOverlapRax: days.reduce((sum, row) => sum + row.sportOverlapRax, 0),
  }
}

import type {
  CardRollup,
  ClaimCandidate,
  ClaimDayResult,
  PlayerCard,
  RaxPerformance,
  RaxTrackerData,
  Sport,
  SportClaimResult,
  SportRollup,
  YearRollup,
} from '../types/rax'
import { monthDayKeyFromClaimDay } from './claimDayKey'
import { getBaseRaxEarned, withEffectiveRax } from './effectiveRax'
import { isUfcCatalogSport } from './passKind'

type IndexedCandidate = Omit<ClaimCandidate, 'status' | 'rankInSport'> & {
  status?: ClaimCandidate['status']
  rankInSport?: number
}

function byRaxThenName(a: IndexedCandidate, b: IndexedCandidate): number {
  const raxDiff = b.performance.raxEarned - a.performance.raxEarned
  if (raxDiff !== 0) return raxDiff
  return a.card.name.localeCompare(b.card.name)
}

function createCandidate(
  performance: RaxPerformance,
  card: PlayerCard,
): IndexedCandidate {
  return { performance: withEffectiveRax(performance, card), card }
}

function toClaimCandidate(candidate: IndexedCandidate): ClaimCandidate {
  return {
    performance: candidate.performance,
    card: candidate.card,
    status: candidate.status ?? 'overlap',
    rankInSport: candidate.rankInSport ?? 0,
  }
}

function emptySportRollup(sport: Sport): SportRollup {
  return {
    sport,
    guaranteedRax: 0,
    proBonusRax: 0,
    overlapRax: 0,
    totalClaimableRax: 0,
    guaranteedClaims: 0,
    proBonusClaims: 0,
    overlapCount: 0,
  }
}

function emptyCardRollup(card: PlayerCard): CardRollup {
  return {
    card,
    totalBaseRax: 0,
    guaranteedRax: 0,
    proBonusRax: 0,
    overlapRax: 0,
    totalClaimableRax: 0,
    guaranteedClaims: 0,
    proBonusClaims: 0,
    overlapCount: 0,
    performanceCount: 0,
  }
}

function summedBaseRax(a: RaxPerformance, b: RaxPerformance): number | undefined {
  const aBase = a.baseRaxEarned
  const bBase = b.baseRaxEarned
  const hasA = aBase != null && aBase > 0
  const hasB = bBase != null && bBase > 0
  if (!hasA && !hasB) return undefined
  return (hasA ? aBase : 0) + (hasB ? bBase : 0)
}

/**
 * Real now combines every UFC fight on the same OTD day into one claim (summed earnings).
 * Other sports still use each card's best performance that month/day.
 */
function collapsePerformancesPerCard(candidates: IndexedCandidate[]): IndexedCandidate[] {
  const byCard = new Map<string, IndexedCandidate>()
  for (const candidate of candidates) {
    const existing = byCard.get(candidate.card.id)
    if (!existing) {
      byCard.set(candidate.card.id, candidate)
      continue
    }
    if (isUfcCatalogSport(candidate.card.sport)) {
      const primary =
        candidate.performance.raxEarned >= existing.performance.raxEarned ? candidate : existing
      const baseRaxEarned = summedBaseRax(existing.performance, candidate.performance)
      byCard.set(candidate.card.id, {
        ...primary,
        performance: {
          ...primary.performance,
          raxEarned: existing.performance.raxEarned + candidate.performance.raxEarned,
          ...(baseRaxEarned != null ? { baseRaxEarned } : {}),
        },
      })
      continue
    }
    if (candidate.performance.raxEarned > existing.performance.raxEarned) {
      byCard.set(candidate.card.id, candidate)
    }
  }
  return [...byCard.values()]
}

export function getValidPerformances(data: RaxTrackerData): ClaimCandidate[] {
  const cardsById = new Map(data.cards.map((card) => [card.id, card]))
  const candidates: ClaimCandidate[] = []
  for (const performance of data.performances) {
    const card = cardsById.get(performance.cardId)
    if (!card || !performance.claimDay || performance.raxEarned <= 0) continue
    candidates.push({
      performance,
      card,
      status: 'overlap',
      rankInSport: 0,
    })
  }
  return candidates
}

export function computeClaimDayResults(data: RaxTrackerData): ClaimDayResult[] {
  const cardsById = new Map(data.cards.map((card) => [card.id, card]))
  const candidatesByMonthDay = new Map<string, IndexedCandidate[]>()

  for (const performance of data.performances) {
    const card = cardsById.get(performance.cardId)
    const monthDay = monthDayKeyFromClaimDay(performance.claimDay)
    if (!card || !monthDay || performance.raxEarned <= 0) continue
    const dayCandidates = candidatesByMonthDay.get(monthDay) ?? []
    dayCandidates.push(createCandidate(performance, card))
    candidatesByMonthDay.set(monthDay, dayCandidates)
  }

  return [...candidatesByMonthDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthDay, dayCandidates]) =>
      computeClaimDay(
        monthDay,
        collapsePerformancesPerCard(dayCandidates),
        data.settings.proBonusEnabled,
      ),
    )
}

function computeClaimDay(
  claimDay: string,
  dayCandidates: IndexedCandidate[],
  proBonusEnabled: boolean,
): ClaimDayResult {
  const bySport = new Map<Sport, IndexedCandidate[]>()
  for (const candidate of dayCandidates) {
    const sportCandidates = bySport.get(candidate.card.sport) ?? []
    sportCandidates.push(candidate)
    bySport.set(candidate.card.sport, sportCandidates)
  }

  const sports: SportClaimResult[] = []
  const remainingForBonus: IndexedCandidate[] = []

  for (const [sport, sportCandidates] of [...bySport.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ranked = [...sportCandidates].sort(byRaxThenName)
    const guaranteed = ranked.slice(0, 2).map((candidate, index) => {
      candidate.status = 'guaranteed'
      candidate.rankInSport = index + 1
      return toClaimCandidate(candidate)
    })
    const overlaps = ranked.slice(2).map((candidate, index) => {
      candidate.status = 'overlap'
      candidate.rankInSport = index + 3
      remainingForBonus.push(candidate)
      return toClaimCandidate(candidate)
    })

    sports.push({
      sport,
      guaranteed,
      overlaps,
      totalGuaranteedRax: guaranteed.reduce((sum, item) => sum + item.performance.raxEarned, 0),
      totalOverlapRax: overlaps.reduce((sum, item) => sum + item.performance.raxEarned, 0),
    })
  }

  let proBonus: ClaimCandidate | null = null
  if (proBonusEnabled && remainingForBonus.length > 0) {
    const [bestBonus] = [...remainingForBonus].sort(byRaxThenName)
    if (bestBonus) {
      bestBonus.status = 'pro-bonus'
      proBonus = toClaimCandidate(bestBonus)
      const sport = sports.find((result) => result.sport === bestBonus.card.sport)
      if (sport) {
        sport.overlaps = sport.overlaps.map((candidate) =>
          candidate.performance.id === bestBonus.performance.id ? proBonus! : candidate,
        )
      }
    }
  }

  const totalGuaranteedRax = sports.reduce((sum, sport) => sum + sport.totalGuaranteedRax, 0)
  const totalProBonusRax = proBonus?.performance.raxEarned ?? 0
  const totalRawOverlapRax = sports.reduce((sum, sport) => sum + sport.totalOverlapRax, 0)
  const totalOverlapRax = Math.max(0, totalRawOverlapRax - totalProBonusRax)

  return {
    claimDay,
    sports,
    proBonus,
    totalGuaranteedRax,
    totalProBonusRax,
    totalClaimableRax: totalGuaranteedRax + totalProBonusRax,
    totalOverlapRax,
  }
}

export function computeYearRollup(data: RaxTrackerData, results = computeClaimDayResults(data)): YearRollup {
  const cardRollups = new Map(data.cards.map((card) => [card.id, emptyCardRollup(card)]))
  const sportRollups = new Map<Sport, SportRollup>()

  for (const card of data.cards) {
    if (!sportRollups.has(card.sport)) sportRollups.set(card.sport, emptySportRollup(card.sport))
  }

  for (const performance of data.performances) {
    const cardRollup = cardRollups.get(performance.cardId)
    if (!cardRollup || performance.raxEarned <= 0 || !performance.claimDay) continue
    cardRollup.performanceCount += 1
    cardRollup.totalBaseRax += getBaseRaxEarned(performance, cardRollup.card)
  }

  for (const result of results) {
    for (const sportResult of result.sports) {
      const sportRollup = sportRollups.get(sportResult.sport) ?? emptySportRollup(sportResult.sport)

      for (const candidate of [...sportResult.guaranteed, ...sportResult.overlaps]) {
        const cardRollup = cardRollups.get(candidate.card.id)
        if (!cardRollup) continue

        if (candidate.status === 'guaranteed') {
          cardRollup.guaranteedRax += candidate.performance.raxEarned
          cardRollup.guaranteedClaims += 1
          sportRollup.guaranteedRax += candidate.performance.raxEarned
          sportRollup.guaranteedClaims += 1
        } else if (candidate.status === 'pro-bonus') {
          cardRollup.proBonusRax += candidate.performance.raxEarned
          cardRollup.proBonusClaims += 1
          sportRollup.proBonusRax += candidate.performance.raxEarned
          sportRollup.proBonusClaims += 1
        } else {
          cardRollup.overlapRax += candidate.performance.raxEarned
          cardRollup.overlapCount += 1
          sportRollup.overlapRax += candidate.performance.raxEarned
          sportRollup.overlapCount += 1
        }
      }

      sportRollup.totalClaimableRax = sportRollup.guaranteedRax + sportRollup.proBonusRax
      sportRollups.set(sportResult.sport, sportRollup)
    }
  }

  for (const rollup of cardRollups.values()) {
    rollup.totalClaimableRax = rollup.guaranteedRax + rollup.proBonusRax
  }

  const cards = [...cardRollups.values()].sort(
    (a, b) => b.totalClaimableRax - a.totalClaimableRax || a.card.name.localeCompare(b.card.name),
  )
  const sports = [...sportRollups.values()]
    .filter((sport) => sport.guaranteedClaims + sport.proBonusClaims + sport.overlapCount > 0)
    .sort((a, b) => b.totalClaimableRax - a.totalClaimableRax || a.sport.localeCompare(b.sport))

  return {
    totalGuaranteedRax: results.reduce((sum, result) => sum + result.totalGuaranteedRax, 0),
    totalProBonusRax: results.reduce((sum, result) => sum + result.totalProBonusRax, 0),
    totalClaimableRax: results.reduce((sum, result) => sum + result.totalClaimableRax, 0),
    totalOverlapRax: results.reduce((sum, result) => sum + result.totalOverlapRax, 0),
    claimDays: results.length,
    cards,
    sports,
  }
}

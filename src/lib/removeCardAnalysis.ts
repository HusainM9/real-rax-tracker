import { computeClaimDayResults, computeYearRollup } from './claimOptimizer'
import { monthDayKeyFromClaimDay } from './claimDayKey'
import type { ClaimCandidate, ClaimDayResult, PlayerCard, RaxTrackerData } from '../types/rax'

export type RemoveCardGain = {
  claimDay: string
  candidate: ClaimCandidate
  previousStatus: 'overlap'
  newStatus: Exclude<ClaimCandidate['status'], 'overlap'>
}

export type RemoveCardAnalysisResult = {
  card: PlayerCard
  lostClaimableRax: number
  lostGuaranteedRax: number
  lostProBonusRax: number
  lostOverlapRax: number
  freedClaimableRax: number
  netClaimableDelta: number
  gains: RemoveCardGain[]
}

function withoutCard(data: RaxTrackerData, cardId: string): RaxTrackerData {
  return {
    ...data,
    cards: data.cards.filter((card) => card.id !== cardId),
    performances: data.performances.filter((performance) => performance.cardId !== cardId),
  }
}

function candidateMonthDayKey(candidate: ClaimCandidate): string {
  const monthDay = monthDayKeyFromClaimDay(candidate.performance.claimDay)
  return `${candidate.card.id}|${monthDay ?? candidate.performance.claimDay}`
}

function claimableCandidates(day: ClaimDayResult): ClaimCandidate[] {
  return day.sports.flatMap((sport) =>
    [...sport.guaranteed, ...sport.overlaps].filter((candidate) => candidate.status !== 'overlap'),
  )
}

function overlapStatusByKey(results: ClaimDayResult[]): Map<string, ClaimCandidate> {
  const overlaps = new Map<string, ClaimCandidate>()
  for (const day of results) {
    for (const sport of day.sports) {
      for (const candidate of sport.overlaps) {
        if (candidate.status === 'overlap') {
          overlaps.set(candidateMonthDayKey(candidate), candidate)
        }
      }
    }
  }
  return overlaps
}

export function analyzeRemovedCard(
  data: RaxTrackerData,
  cardId: string,
): RemoveCardAnalysisResult | null {
  const card = data.cards.find((item) => item.id === cardId)
  if (!card) return null

  const baseResults = computeClaimDayResults(data)
  const baseRollup = computeYearRollup(data, baseResults)
  const removedRollup = baseRollup.cards.find((rollup) => rollup.card.id === cardId)
  if (!removedRollup) return null

  const without = withoutCard(data, cardId)
  const afterResults = computeClaimDayResults(without)
  const afterRollup = computeYearRollup(without, afterResults)
  const baseOverlaps = overlapStatusByKey(baseResults)

  const gains: RemoveCardGain[] = []
  for (const day of afterResults) {
    for (const candidate of claimableCandidates(day)) {
      if (candidate.status === 'overlap') continue
      const previous = baseOverlaps.get(candidateMonthDayKey(candidate))
      if (!previous) continue
      gains.push({
        claimDay: day.claimDay,
        candidate,
        previousStatus: 'overlap',
        newStatus: candidate.status,
      })
    }
  }

  const freedClaimableRax = gains.reduce(
    (sum, gain) => sum + gain.candidate.performance.raxEarned,
    0,
  )

  return {
    card,
    lostClaimableRax: removedRollup.totalClaimableRax,
    lostGuaranteedRax: removedRollup.guaranteedRax,
    lostProBonusRax: removedRollup.proBonusRax,
    lostOverlapRax: removedRollup.overlapRax,
    freedClaimableRax,
    netClaimableDelta: afterRollup.totalClaimableRax - baseRollup.totalClaimableRax,
    gains: gains.sort(
      (a, b) =>
        b.candidate.performance.raxEarned - a.candidate.performance.raxEarned ||
        a.claimDay.localeCompare(b.claimDay) ||
        a.candidate.card.name.localeCompare(b.candidate.card.name),
    ),
  }
}

export function formatRemoveCardSummary(result: RemoveCardAnalysisResult, salePrice?: number): string {
  const parts: string[] = []
  parts.push(
    `Removing ${result.card.name} drops ${result.lostClaimableRax.toLocaleString()} claimable RAX from your collection`,
  )
  if (result.freedClaimableRax > 0) {
    parts.push(
      `and frees ${result.freedClaimableRax.toLocaleString()} claimable RAX on ${result.gains.length} other claim${result.gains.length === 1 ? '' : 's'}`,
    )
  } else {
    parts.push('and does not increase claimable RAX on other cards')
  }
  parts.push(`(net claimable ${result.netClaimableDelta >= 0 ? '+' : ''}${result.netClaimableDelta.toLocaleString()} RAX)`)
  if (salePrice != null && Number.isFinite(salePrice) && salePrice > 0) {
    const liquidGain = salePrice + result.netClaimableDelta
    parts.push(
      `. Selling for ${salePrice.toLocaleString()} RAX ≈ ${liquidGain >= 0 ? '+' : ''}${liquidGain.toLocaleString()} RAX vs keeping the pass (sale + net claimable change)`,
    )
  }
  return parts.join(' ')
}

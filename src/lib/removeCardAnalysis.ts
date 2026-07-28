import { computeClaimDayResults, computeYearRollup } from './claimOptimizer'
import { monthDayKeyFromClaimDay } from './claimDayKey'
import type {
  ClaimCandidate,
  ClaimDayResult,
  PlayerCard,
  RaxTrackerData,
  YearRollup,
} from '../types/rax'
import { isPlayerPassForSell } from './passKind'

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

type RemoveCardAnalysisBase = {
  baseResults: ClaimDayResult[]
  baseRollup: YearRollup
  baseOverlaps: Map<string, ClaimCandidate>
}

function withoutCard(data: RaxTrackerData, cardId: string): RaxTrackerData {
  return withoutCards(data, [cardId])
}

/** Simulation-only: drop owned cards + their performances from the collection baseline. */
export function withoutCards(data: RaxTrackerData, cardIds: readonly string[]): RaxTrackerData {
  if (cardIds.length === 0) return data
  const removed = new Set(cardIds)
  return {
    ...data,
    cards: data.cards.filter((card) => !removed.has(card.id)),
    performances: data.performances.filter((performance) => !removed.has(performance.cardId)),
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

function buildRemoveCardAnalysisBase(data: RaxTrackerData): RemoveCardAnalysisBase {
  const baseResults = computeClaimDayResults(data)
  return {
    baseResults,
    baseRollup: computeYearRollup(data, baseResults),
    baseOverlaps: overlapStatusByKey(baseResults),
  }
}

function analyzeRemovedCardWithBase(
  data: RaxTrackerData,
  cardId: string,
  base: RemoveCardAnalysisBase,
): RemoveCardAnalysisResult | null {
  const card = data.cards.find((item) => item.id === cardId)
  if (!card) return null

  const removedRollup = base.baseRollup.cards.find((rollup) => rollup.card.id === cardId)
  if (!removedRollup) return null

  const without = withoutCard(data, cardId)
  const afterResults = computeClaimDayResults(without)
  const afterRollup = computeYearRollup(without, afterResults)

  const gains: RemoveCardGain[] = []
  for (const day of afterResults) {
    for (const candidate of claimableCandidates(day)) {
      if (candidate.status === 'overlap') continue
      const previous = base.baseOverlaps.get(candidateMonthDayKey(candidate))
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
    netClaimableDelta: afterRollup.totalClaimableRax - base.baseRollup.totalClaimableRax,
    gains: gains.sort(
      (a, b) =>
        b.candidate.performance.raxEarned - a.candidate.performance.raxEarned ||
        a.claimDay.localeCompare(b.claimDay) ||
        a.candidate.card.name.localeCompare(b.candidate.card.name),
    ),
  }
}

export function analyzeRemovedCard(
  data: RaxTrackerData,
  cardId: string,
): RemoveCardAnalysisResult | null {
  return analyzeRemovedCardWithBase(data, cardId, buildRemoveCardAnalysisBase(data))
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

export type SaleComparison = {
  salePrice: number
  netClaimableDelta: number
  netVsKeeping: number
  breakEvenSalePrice: number
}

export function computeSaleComparison(
  result: RemoveCardAnalysisResult,
  salePrice: number,
): SaleComparison {
  return {
    salePrice,
    netClaimableDelta: result.netClaimableDelta,
    netVsKeeping: salePrice + result.netClaimableDelta,
    breakEvenSalePrice: Math.max(0, -result.netClaimableDelta),
  }
}

export function formatSignedRax(value: number): string {
  const formatted = Math.round(Math.abs(value)).toLocaleString()
  if (value > 0) return `+${formatted}`
  if (value < 0) return `-${formatted}`
  return formatted
}

export function isNotNeededForClaims(netClaimableDelta: number): boolean {
  return netClaimableDelta === 0
}

export type BulkSellRankRow = {
  analysis: RemoveCardAnalysisResult
  claimableNow: number
  sortNet: number
}

export type SkippedSellRankPass = {
  cardId: string
  name: string
  sport: PlayerCard['sport']
  season: string
  rarityLabel?: string
  reason: 'no_earnings' | 'analysis_failed'
  detail: string
}

export type BulkSellRankResult = {
  rankings: BulkSellRankRow[]
  skippedWithoutEarnings: number
  skippedTeamPasses: number
  skippedPlayerPasses: SkippedSellRankPass[]
}

export type SellRankProgress = {
  current: number
  total: number
  label: string
}

type RankAccumulator = {
  rows: BulkSellRankRow[]
  skippedWithoutEarnings: number
  skippedTeamPasses: number
  skippedPlayerPasses: SkippedSellRankPass[]
}

function finalizeSellRankings(acc: RankAccumulator): BulkSellRankResult {
  return {
    rankings: acc.rows.sort(
      (a, b) =>
        b.sortNet - a.sortNet ||
        b.analysis.freedClaimableRax - a.analysis.freedClaimableRax ||
        b.claimableNow - a.claimableNow ||
        a.analysis.card.name.localeCompare(b.analysis.card.name),
    ),
    skippedWithoutEarnings: acc.skippedWithoutEarnings,
    skippedTeamPasses: acc.skippedTeamPasses,
    skippedPlayerPasses: acc.skippedPlayerPasses.sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.sport.localeCompare(b.sport) ||
        a.season.localeCompare(b.season),
    ),
  }
}

function rankCardBatch(
  data: RaxTrackerData,
  base: RemoveCardAnalysisBase,
  rollupByCardId: Map<string, YearRollup['cards'][number]>,
  acc: RankAccumulator,
  cards: PlayerCard[],
): void {
  for (const card of cards) {
    if (!isPlayerPassForSell(card)) {
      acc.skippedTeamPasses += 1
      continue
    }

    const rollup = rollupByCardId.get(card.id)
    if (!rollup || rollup.performanceCount === 0) {
      acc.skippedWithoutEarnings += 1
      acc.skippedPlayerPasses.push({
        cardId: card.id,
        name: card.name,
        sport: card.sport,
        season: card.season,
        rarityLabel: card.rarityLabel,
        reason: 'no_earnings',
        detail: 'No RAX earnings rows — add earnings on Entry or re-import this pass.',
      })
      continue
    }

    const analysis = analyzeRemovedCardWithBase(data, card.id, base)
    if (!analysis) {
      acc.skippedPlayerPasses.push({
        cardId: card.id,
        name: card.name,
        sport: card.sport,
        season: card.season,
        rarityLabel: card.rarityLabel,
        reason: 'analysis_failed',
        detail: 'Could not analyze this pass for sell ranking.',
      })
      continue
    }

    acc.rows.push({
      analysis,
      claimableNow: rollup.totalClaimableRax,
      sortNet: analysis.netClaimableDelta,
    })
  }
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0)
  })
}

export function rankAllRemovedCards(data: RaxTrackerData): BulkSellRankResult {
  const base = buildRemoveCardAnalysisBase(data)
  const rollupByCardId = new Map(base.baseRollup.cards.map((rollup) => [rollup.card.id, rollup]))
  const acc: RankAccumulator = {
    rows: [],
    skippedWithoutEarnings: 0,
    skippedTeamPasses: 0,
    skippedPlayerPasses: [],
  }

  rankCardBatch(data, base, rollupByCardId, acc, data.cards)
  return finalizeSellRankings(acc)
}

export async function rankAllRemovedCardsAsync(
  data: RaxTrackerData,
  options?: {
    onProgress?: (progress: SellRankProgress) => void
    signal?: AbortSignal
    batchSize?: number
  },
): Promise<BulkSellRankResult> {
  const base = buildRemoveCardAnalysisBase(data)
  const rollupByCardId = new Map(base.baseRollup.cards.map((rollup) => [rollup.card.id, rollup]))
  const acc: RankAccumulator = {
    rows: [],
    skippedWithoutEarnings: 0,
    skippedTeamPasses: 0,
    skippedPlayerPasses: [],
  }

  const cards = data.cards
  const batchSize = Math.max(options?.batchSize ?? 8, 1)

  for (let index = 0; index < cards.length; index += batchSize) {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const batch = cards.slice(index, index + batchSize)
    rankCardBatch(data, base, rollupByCardId, acc, batch)
    const current = Math.min(index + batch.length, cards.length)
    options?.onProgress?.({
      current,
      total: cards.length,
      label: batch[batch.length - 1]?.name || 'Finishing…',
    })
    await yieldToMain()
  }

  return finalizeSellRankings(acc)
}

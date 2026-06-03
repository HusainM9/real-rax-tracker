import { CALENDAR_MONTH_NAMES } from './calendarView'
import { monthIndexFromClaimDay } from './claimDayKey'
import { computeClaimDayResults } from './claimOptimizer'
import type { ParsedRealAppToolsRow } from './realAppToolsImport'
import type { ClaimCandidate, PlayerCard, RaxTrackerData, Sport } from '../types/rax'

export type PotentialProfile = {
  name: string
  sport: Sport
  season: string
  simulatedRarityLabel?: string
  passKind?: PlayerCard['passKind']
}

function candidateKey(candidate: ClaimCandidate): string {
  return `${candidate.card.id}|${candidate.performance.claimDay}|${candidate.performance.raxEarned}`
}

function overlapCandidates(day: ReturnType<typeof computeClaimDayResults>[number]): ClaimCandidate[] {
  return day.sports.flatMap((sport) =>
    sport.overlaps.filter((candidate) => candidate.status === 'overlap'),
  )
}

function buildClaimableByKey(data: RaxTrackerData): Map<string, ClaimCandidate['status']> {
  const claimable = new Map<string, ClaimCandidate['status']>()
  for (const day of computeClaimDayResults(data)) {
    for (const sport of day.sports) {
      for (const candidate of [...sport.guaranteed, ...sport.overlaps]) {
        if (candidate.status !== 'overlap') {
          claimable.set(candidateKey(candidate), candidate.status)
        }
      }
    }
  }
  return claimable
}

export type PotentialMonthlyNet = {
  monthIdx: number
  month: string
  potentialGain: number
  displacedLoss: number
  netDelta: number
}

export type DisplacedCardSummary = {
  cardId: string
  name: string
  sport: Sport
  season: string
  daysDisplaced: number
  raxLost: number
}

export type PotentialAnalysisResult = {
  candidates: Array<{ day: ReturnType<typeof computeClaimDayResults>[number]; candidate: ClaimCandidate }>
  claimableRax: number
  overlapRax: number
  displacedExisting: Array<{
    day: ReturnType<typeof computeClaimDayResults>[number]
    candidate: ClaimCandidate
    previousStatus: Exclude<ClaimCandidate['status'], 'overlap'>
  }>
  displacedRax: number
  displacedByCard: DisplacedCardSummary[]
  monthlyNet: PotentialMonthlyNet[]
}

export function summarizeDisplacedByCard(
  displacedExisting: PotentialAnalysisResult['displacedExisting'],
): DisplacedCardSummary[] {
  const byCard = new Map<string, DisplacedCardSummary>()

  for (const { candidate } of displacedExisting) {
    const existing = byCard.get(candidate.card.id)
    if (existing) {
      existing.daysDisplaced += 1
      existing.raxLost += candidate.performance.raxEarned
      continue
    }

    byCard.set(candidate.card.id, {
      cardId: candidate.card.id,
      name: candidate.card.name,
      sport: candidate.card.sport,
      season: candidate.card.season,
      daysDisplaced: 1,
      raxLost: candidate.performance.raxEarned,
    })
  }

  return [...byCard.values()].sort(
    (a, b) => b.raxLost - a.raxLost || a.name.localeCompare(b.name),
  )
}

function addMonthlyRax(
  buckets: Map<number, { gain: number; loss: number }>,
  claimDay: string,
  field: 'gain' | 'loss',
  rax: number,
): void {
  const monthIdx = monthIndexFromClaimDay(claimDay)
  if (monthIdx < 0) return
  const bucket = buckets.get(monthIdx) ?? { gain: 0, loss: 0 }
  bucket[field] += rax
  buckets.set(monthIdx, bucket)
}

export function buildPotentialMonthlyNet(
  potentialCandidates: PotentialAnalysisResult['candidates'],
  displacedExisting: PotentialAnalysisResult['displacedExisting'],
): PotentialMonthlyNet[] {
  const buckets = new Map<number, { gain: number; loss: number }>()

  for (const { candidate } of potentialCandidates) {
    if (candidate.status === 'overlap') continue
    addMonthlyRax(buckets, candidate.performance.claimDay, 'gain', candidate.performance.raxEarned)
  }

  for (const { candidate } of displacedExisting) {
    addMonthlyRax(buckets, candidate.performance.claimDay, 'loss', candidate.performance.raxEarned)
  }

  return [...buckets.entries()]
    .map(([monthIdx, { gain, loss }]) => ({
      monthIdx,
      month: CALENDAR_MONTH_NAMES[monthIdx] ?? 'Other',
      potentialGain: gain,
      displacedLoss: loss,
      netDelta: gain - loss,
    }))
    .sort((a, b) => a.monthIdx - b.monthIdx)
}

export function analyzePotentialCard(
  data: RaxTrackerData,
  profile: PotentialProfile,
  rows: ParsedRealAppToolsRow[],
): PotentialAnalysisResult | null {
  if (rows.length === 0) return null

  const potentialCard: PlayerCard = {
    id: 'potential-card',
    name: profile.name.trim() || 'Potential card',
    sport: profile.sport,
    season: profile.season.trim(),
    notes: 'Potential card analysis',
    passKind: profile.passKind ?? 'player',
    simulatedRarityLabel: profile.simulatedRarityLabel?.trim() || undefined,
    createdAt: new Date().toISOString(),
  }
  const potentialData = {
    ...data,
    cards: [...data.cards, potentialCard],
    performances: [
      ...data.performances,
      ...rows.map((row, index) => {
        const baseRax = row.baseRaxEarned ?? row.raxEarned
        return {
          id: `potential-${index}`,
          cardId: potentialCard.id,
          claimDay: row.claimDay,
          raxEarned: baseRax,
          baseRaxEarned: baseRax,
          note: row.note,
          createdAt: new Date().toISOString(),
        }
      }),
    ],
  }
  const baseClaimableByKey = buildClaimableByKey(data)
  const results = computeClaimDayResults(potentialData)
  const potentialCandidates = results.flatMap((day) =>
    day.sports.flatMap((sport) =>
      [...sport.guaranteed, ...sport.overlaps]
        .filter((candidate) => candidate.card.id === potentialCard.id)
        .map((candidate) => ({ day, candidate })),
    ),
  )
  const displacedExisting = results.flatMap((day) =>
    overlapCandidates(day)
      .filter((candidate) => candidate.card.id !== potentialCard.id)
      .map((candidate) => ({
        day,
        candidate,
        previousStatus: baseClaimableByKey.get(candidateKey(candidate)),
      }))
      .filter(
        (row): row is {
          day: (typeof results)[number]
          candidate: ClaimCandidate
          previousStatus: Exclude<ClaimCandidate['status'], 'overlap'>
        } => row.previousStatus === 'guaranteed' || row.previousStatus === 'pro-bonus',
      ),
  )
  const displacedRax = displacedExisting.reduce(
    (sum, { candidate }) => sum + candidate.performance.raxEarned,
    0,
  )

  return {
    candidates: potentialCandidates,
    claimableRax: potentialCandidates
      .filter(({ candidate }) => candidate.status !== 'overlap')
      .reduce((sum, { candidate }) => sum + candidate.performance.raxEarned, 0),
    overlapRax: potentialCandidates
      .filter(({ candidate }) => candidate.status === 'overlap')
      .reduce((sum, { candidate }) => sum + candidate.performance.raxEarned, 0),
    displacedExisting,
    displacedRax,
    displacedByCard: summarizeDisplacedByCard(displacedExisting),
    monthlyNet: buildPotentialMonthlyNet(potentialCandidates, displacedExisting),
  }
}

import { computeClaimDayResults } from './claimOptimizer'
import type { ParsedRealAppToolsRow } from './realAppToolsImport'
import type { ClaimCandidate, PlayerCard, RaxTrackerData, Sport } from '../types/rax'

export type PotentialProfile = {
  name: string
  sport: Sport
  season: string
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
    createdAt: new Date().toISOString(),
  }
  const potentialData = {
    ...data,
    cards: [...data.cards, potentialCard],
    performances: [
      ...data.performances,
      ...rows.map((row, index) => ({
        id: `potential-${index}`,
        cardId: potentialCard.id,
        claimDay: row.claimDay,
        raxEarned: row.raxEarned,
        note: row.note,
        createdAt: new Date().toISOString(),
      })),
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
  }
}

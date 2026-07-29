import { CALENDAR_MONTH_NAMES } from './calendarView'
import { monthIndexFromClaimDay } from './claimDayKey'
import { computeClaimDayResults, computeYearRollup } from './claimOptimizer'
import type { ParsedRealAppToolsRow } from './realAppToolsImport'
import type {
  ClaimCandidate,
  ClaimDayResult,
  ClaimStatus,
  PlayerCard,
  RaxTrackerData,
  Sport,
} from '../types/rax'

export const POTENTIAL_CARD_ID = 'potential-card'

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
  guaranteedGain: number
  guaranteedDisplacedLoss: number
  guaranteedNetDelta: number
}

export type DisplacedCardSummary = {
  cardId: string
  name: string
  sport: Sport
  season: string
  passKind?: 'player' | 'team'
  avatar?: string
  daysDisplaced: number
  raxLost: number
}

export type PotentialAnalysisResult = {
  candidates: Array<{ day: ClaimDayResult; candidate: ClaimCandidate }>
  /** Guaranteed + Pro bonus claimable RAX from the new pass. */
  claimableRax: number
  /** Guaranteed-only claimable RAX from the new pass. */
  guaranteedRax: number
  /** Pro bonus claimable RAX from the new pass. */
  proBonusRax: number
  overlapRax: number
  displacedExisting: Array<{
    day: ClaimDayResult
    candidate: ClaimCandidate
    previousStatus: Exclude<ClaimCandidate['status'], 'overlap'>
  }>
  displacedRax: number
  displacedGuaranteedRax: number
  displacedProBonusRax: number
  displacedByCard: DisplacedCardSummary[]
  displacedByCardGuaranteed: DisplacedCardSummary[]
  monthlyNet: PotentialMonthlyNet[]
  /** Per OTD day sport ladder — same rules as the Calendar page. */
  claimDayBreakdowns: PotentialClaimDayBreakdown[]
  /**
   * True collection claimable delta (with Pro): after − before year rollup.
   * Prefer this over claimableRax − displacedRax when Pro reshuffles other cards.
   */
  collectionNetDelta: number
  /** True guaranteed-only collection delta (with Pro enabled on both sides). */
  collectionGuaranteedNetDelta: number
}

function withProBonusEnabled(data: RaxTrackerData): RaxTrackerData {
  return {
    ...data,
    settings: { ...data.settings, proBonusEnabled: true },
  }
}

export function netGuaranteedDelta(result: PotentialAnalysisResult): number {
  return result.collectionGuaranteedNetDelta
}

export function netWithProDelta(result: PotentialAnalysisResult): number {
  return result.collectionNetDelta
}

export type PotentialClaimLadderEntry = {
  cardId: string
  name: string
  sport: Sport
  season: string
  passKind?: 'player' | 'team'
  avatar?: string
  isPotential: boolean
  raxEarned: number
  rankInSport: number
  statusAfter: ClaimStatus
  statusBefore: ClaimStatus | null
  deltaLabel: string
  raxDelta: number
}

export type PotentialSportDayBreakdown = {
  sport: Sport
  ladder: PotentialClaimLadderEntry[]
  sportNetDelta: number
}

export type PotentialClaimDayBreakdown = {
  claimDay: string
  monthLabel: string
  sports: PotentialSportDayBreakdown[]
  proBonusBefore: { cardId: string; name: string; sport: Sport; raxEarned: number } | null
  proBonusAfter: { cardId: string; name: string; sport: Sport; raxEarned: number } | null
  dayNetDelta: number
}

function sportLadder(day: ClaimDayResult, sport: Sport): ClaimCandidate[] {
  const block = day.sports.find((entry) => entry.sport === sport)
  if (!block) return []
  return [...block.guaranteed, ...block.overlaps]
}

function statusForCardOnDay(
  day: ClaimDayResult | undefined,
  sport: Sport,
  cardId: string,
): ClaimStatus | null {
  if (!day) return null
  return sportLadder(day, sport).find((candidate) => candidate.card.id === cardId)?.status ?? null
}

function formatStatusLabel(status: ClaimStatus): string {
  switch (status) {
    case 'guaranteed':
      return 'guaranteed'
    case 'pro-bonus':
      return 'Pro bonus'
    case 'overlap':
      return 'overlap'
  }
}

function describeClaimStatusChange(
  isPotential: boolean,
  statusBefore: ClaimStatus | null,
  statusAfter: ClaimStatus,
  rankInSport: number,
  raxEarned: number,
): { deltaLabel: string; raxDelta: number } {
  if (isPotential) {
    if (statusAfter === 'overlap') {
      return {
        deltaLabel: `New pass · #${rankInSport} overlap (no net)`,
        raxDelta: 0,
      }
    }
    return {
      deltaLabel: `New pass · #${rankInSport} ${formatStatusLabel(statusAfter)} (+${Math.round(raxEarned).toLocaleString()} RAX)`,
      raxDelta: raxEarned,
    }
  }

  if (!statusBefore) {
    return { deltaLabel: '—', raxDelta: 0 }
  }

  if (statusBefore === statusAfter) {
    return {
      deltaLabel: `Still #${rankInSport} ${formatStatusLabel(statusAfter)}`,
      raxDelta: 0,
    }
  }

  if (
    (statusBefore === 'guaranteed' || statusBefore === 'pro-bonus') &&
    statusAfter === 'overlap'
  ) {
    return {
      deltaLabel: `Was ${formatStatusLabel(statusBefore)} → #${rankInSport} overlap (−${Math.round(raxEarned).toLocaleString()} RAX)`,
      raxDelta: -raxEarned,
    }
  }

  if (statusBefore === 'overlap' && statusAfter !== 'overlap') {
    return {
      deltaLabel: `Was overlap → #${rankInSport} ${formatStatusLabel(statusAfter)} (+${Math.round(raxEarned).toLocaleString()} RAX)`,
      raxDelta: raxEarned,
    }
  }

  return {
    deltaLabel: `#${rankInSport} ${formatStatusLabel(statusBefore)} → ${formatStatusLabel(statusAfter)}`,
    raxDelta: 0,
  }
}

function proBonusSnapshot(
  day: ClaimDayResult | undefined,
): { cardId: string; name: string; sport: Sport; raxEarned: number } | null {
  if (!day?.proBonus) return null
  return {
    cardId: day.proBonus.card.id,
    name: day.proBonus.card.name,
    sport: day.proBonus.card.sport,
    raxEarned: day.proBonus.performance.raxEarned,
  }
}

export function buildPotentialClaimDayBreakdowns(
  baseResults: ClaimDayResult[],
  withPotentialResults: ClaimDayResult[],
  potentialCandidates: PotentialAnalysisResult['candidates'],
  displacedExisting: PotentialAnalysisResult['displacedExisting'],
): PotentialClaimDayBreakdown[] {
  const baseByDay = new Map(baseResults.map((day) => [day.claimDay, day]))
  const afterByDay = new Map(withPotentialResults.map((day) => [day.claimDay, day]))

  const relevantDays = new Set<string>()
  for (const { day } of potentialCandidates) {
    relevantDays.add(day.claimDay)
  }
  for (const { day } of displacedExisting) {
    relevantDays.add(day.claimDay)
  }

  const breakdowns: PotentialClaimDayBreakdown[] = []

  for (const claimDay of [...relevantDays].sort((a, b) => a.localeCompare(b))) {
    const afterDay = afterByDay.get(claimDay)
    if (!afterDay) continue
    const beforeDay = baseByDay.get(claimDay)

    const sports = new Set<Sport>([
      ...afterDay.sports.map((entry) => entry.sport),
      ...(beforeDay?.sports.map((entry) => entry.sport) ?? []),
    ])

    const sportBreakdowns: PotentialSportDayBreakdown[] = []

    for (const sport of [...sports].sort((a, b) => a.localeCompare(b))) {
      const ladder = sportLadder(afterDay, sport)
      if (ladder.length === 0) continue

      const entries: PotentialClaimLadderEntry[] = ladder.map((candidate) => {
        const isPotential = candidate.card.id === POTENTIAL_CARD_ID
        const statusBefore = isPotential
          ? null
          : statusForCardOnDay(beforeDay, sport, candidate.card.id)
        const { deltaLabel, raxDelta } = describeClaimStatusChange(
          isPotential,
          statusBefore,
          candidate.status,
          candidate.rankInSport,
          candidate.performance.raxEarned,
        )

        return {
          cardId: candidate.card.id,
          name: candidate.card.name,
          sport,
          season: candidate.card.season,
          passKind: candidate.card.passKind,
          avatar: candidate.card.avatar,
          isPotential,
          raxEarned: candidate.performance.raxEarned,
          rankInSport: candidate.rankInSport,
          statusAfter: candidate.status,
          statusBefore,
          deltaLabel,
          raxDelta,
        }
      })

      sportBreakdowns.push({
        sport,
        ladder: entries,
        sportNetDelta: entries.reduce((sum, entry) => sum + entry.raxDelta, 0),
      })
    }

    const monthIdx = monthIndexFromClaimDay(claimDay)
    breakdowns.push({
      claimDay,
      monthLabel: monthIdx >= 0 ? (CALENDAR_MONTH_NAMES[monthIdx] ?? 'Other') : 'Other',
      sports: sportBreakdowns,
      proBonusBefore: proBonusSnapshot(beforeDay),
      proBonusAfter: proBonusSnapshot(afterDay),
      dayNetDelta: sportBreakdowns.reduce((sum, sport) => sum + sport.sportNetDelta, 0),
    })
  }

  return breakdowns
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
      passKind: candidate.card.passKind === 'team' ? 'team' : 'player',
      avatar: candidate.card.avatar,
      daysDisplaced: 1,
      raxLost: candidate.performance.raxEarned,
    })
  }

  return [...byCard.values()].sort(
    (a, b) => b.raxLost - a.raxLost || a.name.localeCompare(b.name),
  )
}

type MonthlyNetBucket = {
  gain: number
  loss: number
  guaranteedGain: number
  guaranteedLoss: number
}

function addMonthlyRax(
  buckets: Map<number, MonthlyNetBucket>,
  claimDay: string,
  field: 'gain' | 'loss' | 'guaranteedGain' | 'guaranteedLoss',
  rax: number,
): void {
  const monthIdx = monthIndexFromClaimDay(claimDay)
  if (monthIdx < 0) return
  const bucket = buckets.get(monthIdx) ?? {
    gain: 0,
    loss: 0,
    guaranteedGain: 0,
    guaranteedLoss: 0,
  }
  bucket[field] += rax
  buckets.set(monthIdx, bucket)
}

export function buildPotentialMonthlyNet(
  potentialCandidates: PotentialAnalysisResult['candidates'],
  displacedExisting: PotentialAnalysisResult['displacedExisting'],
): PotentialMonthlyNet[] {
  const buckets = new Map<number, MonthlyNetBucket>()

  for (const { candidate } of potentialCandidates) {
    if (candidate.status === 'overlap') continue
    addMonthlyRax(buckets, candidate.performance.claimDay, 'gain', candidate.performance.raxEarned)
    if (candidate.status === 'guaranteed') {
      addMonthlyRax(
        buckets,
        candidate.performance.claimDay,
        'guaranteedGain',
        candidate.performance.raxEarned,
      )
    }
  }

  for (const { candidate, previousStatus } of displacedExisting) {
    addMonthlyRax(buckets, candidate.performance.claimDay, 'loss', candidate.performance.raxEarned)
    if (previousStatus === 'guaranteed') {
      addMonthlyRax(
        buckets,
        candidate.performance.claimDay,
        'guaranteedLoss',
        candidate.performance.raxEarned,
      )
    }
  }

  return [...buckets.entries()]
    .map(([monthIdx, bucket]) => ({
      monthIdx,
      month: CALENDAR_MONTH_NAMES[monthIdx] ?? 'Other',
      potentialGain: bucket.gain,
      displacedLoss: bucket.loss,
      netDelta: bucket.gain - bucket.loss,
      guaranteedGain: bucket.guaranteedGain,
      guaranteedDisplacedLoss: bucket.guaranteedLoss,
      guaranteedNetDelta: bucket.guaranteedGain - bucket.guaranteedLoss,
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
    id: POTENTIAL_CARD_ID,
    name: profile.name.trim() || 'Potential card',
    sport: profile.sport,
    season: profile.season.trim(),
    notes: 'Potential card analysis',
    passKind: profile.passKind ?? 'player',
    simulatedRarityLabel: profile.simulatedRarityLabel?.trim() || undefined,
    createdAt: new Date().toISOString(),
  }
  const analysisData = withProBonusEnabled(data)
  const potentialData = {
    ...analysisData,
    cards: [...analysisData.cards, potentialCard],
    performances: [
      ...analysisData.performances,
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
  const baseClaimableByKey = buildClaimableByKey(analysisData)
  const baseResults = computeClaimDayResults(analysisData)
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
  const displacedGuaranteedExisting = displacedExisting.filter(
    ({ previousStatus }) => previousStatus === 'guaranteed',
  )
  const displacedProBonusExisting = displacedExisting.filter(
    ({ previousStatus }) => previousStatus === 'pro-bonus',
  )
  const displacedGuaranteedRax = displacedGuaranteedExisting.reduce(
    (sum, { candidate }) => sum + candidate.performance.raxEarned,
    0,
  )
  const displacedProBonusRax = displacedProBonusExisting.reduce(
    (sum, { candidate }) => sum + candidate.performance.raxEarned,
    0,
  )
  const guaranteedCandidates = potentialCandidates.filter(
    ({ candidate }) => candidate.status === 'guaranteed',
  )
  const proBonusCandidates = potentialCandidates.filter(
    ({ candidate }) => candidate.status === 'pro-bonus',
  )

  const claimDayBreakdowns = buildPotentialClaimDayBreakdowns(
    baseResults,
    results,
    potentialCandidates,
    displacedExisting,
  )

  const beforeClaimable = computeYearRollup(analysisData).totalClaimableRax
  const afterClaimable = computeYearRollup(potentialData).totalClaimableRax
  const beforeGuaranteed = computeYearRollup(analysisData).totalGuaranteedRax
  const afterGuaranteed = computeYearRollup(potentialData).totalGuaranteedRax

  return {
    candidates: potentialCandidates,
    claimableRax: potentialCandidates
      .filter(({ candidate }) => candidate.status !== 'overlap')
      .reduce((sum, { candidate }) => sum + candidate.performance.raxEarned, 0),
    guaranteedRax: guaranteedCandidates.reduce(
      (sum, { candidate }) => sum + candidate.performance.raxEarned,
      0,
    ),
    proBonusRax: proBonusCandidates.reduce(
      (sum, { candidate }) => sum + candidate.performance.raxEarned,
      0,
    ),
    overlapRax: potentialCandidates
      .filter(({ candidate }) => candidate.status === 'overlap')
      .reduce((sum, { candidate }) => sum + candidate.performance.raxEarned, 0),
    displacedExisting,
    displacedRax,
    displacedGuaranteedRax,
    displacedProBonusRax,
    displacedByCard: summarizeDisplacedByCard(displacedExisting),
    displacedByCardGuaranteed: summarizeDisplacedByCard(displacedGuaranteedExisting),
    monthlyNet: buildPotentialMonthlyNet(potentialCandidates, displacedExisting),
    claimDayBreakdowns,
    collectionNetDelta: afterClaimable - beforeClaimable,
    collectionGuaranteedNetDelta: afterGuaranteed - beforeGuaranteed,
  }
}

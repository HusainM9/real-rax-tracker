import type { CatalogImportProfile } from './catalogApi'
import { importCatalogProfileIntoData } from './catalogImport'
import { chooseProBonus, computeSportClaim, computeClaimDayResults, computeYearRollup } from './claimOptimizer'
import { monthDayKeyFromClaimDay } from './claimDayKey'
import { isUfcCatalogSport } from '../../lib/passKind'
import type { ClaimCandidate, ClaimDayResult, PlayerCard, RaxPerformance, RaxTrackerData, Sport, SportClaimResult } from '../types/rax'

type OrderedCandidate = Pick<ClaimCandidate, 'card' | 'performance'> & { order: number }
type PreparedDay = { result: ClaimDayResult; sports: Map<Sport, { result: SportClaimResult; candidates: OrderedCandidate[] }> }
type IndexedPerformance = { performance: RaxPerformance; order: number }

export type ImportScenarioScore = {
  netClaimableDelta: number
  netGuaranteedDelta: number
  newClaimableRax: number
  overlapRax: number
  displacedRax: number
}

export type PreparedImportScenario = {
  source: RaxTrackerData
  cardsByKey: Map<string, PlayerCard>
  rowsByCard: Map<string, IndexedPerformance[]>
  days: Map<string, PreparedDay>
  dayKeys: string[]
  reservedIds: Set<string>
  claimable: number
  guaranteed: number
  legacyDuplicateIds: boolean
}

/** Per-run state only: callers prepare again when collection/assumptions change. */
export function prepareImportScenario(data: RaxTrackerData): PreparedImportScenario {
  const cardsByKey = new Map<string, PlayerCard>()
  const reservedIds = new Set(data.cards.map((card) => card.id))
  for (const card of data.cards) {
    if (card.externalKey && !cardsByKey.has(card.externalKey)) cardsByKey.set(card.externalKey, card)
  }
  const rowsByCard = new Map<string, IndexedPerformance[]>()
  const performanceIds = new Set<string>()
  let legacyDuplicateIds = false
  const firstOrderByDay = new Map<string, Map<string, number>>()
  data.performances.forEach((performance, order) => {
    if (performanceIds.has(performance.id)) legacyDuplicateIds = true
    performanceIds.add(performance.id)
    reservedIds.add(performance.id)
    const rows = rowsByCard.get(performance.cardId) ?? []
    rows.push({ performance, order })
    rowsByCard.set(performance.cardId, rows)
    const day = monthDayKeyFromClaimDay(performance.claimDay)
    if (!day || performance.raxEarned <= 0) return
    const orders = firstOrderByDay.get(day) ?? new Map<string, number>()
    if (!orders.has(performance.cardId)) orders.set(performance.cardId, order)
    firstOrderByDay.set(day, orders)
  })
  const results = computeClaimDayResults({ ...data, settings: { ...data.settings, proBonusEnabled: true } })
  const days = new Map(results.map((result) => [result.claimDay, {
    result,
    sports: new Map(result.sports.map((sport) => [sport.sport, {
      result: sport,
      candidates: [...sport.guaranteed, ...sport.overlaps].map((candidate) => ({
        card: candidate.card,
        performance: candidate.performance,
        order: firstOrderByDay.get(result.claimDay)!.get(candidate.card.id)!,
      })),
    }])),
  }]))
  return {
    source: data, cardsByKey, rowsByCard, days, reservedIds, legacyDuplicateIds,
    dayKeys: results.map((day) => day.claimDay),
    claimable: results.reduce((sum, day) => sum + day.totalClaimableRax, 0),
    guaranteed: results.reduce((sum, day) => sum + day.totalGuaranteedRax, 0),
  }
}

export function scoreImportScenario(
  prepared: PreparedImportScenario,
  profile: CatalogImportProfile,
  rarityLabel: string,
): ImportScenarioScore | null {
  if (!profile.rows.length) return null
  const owned = prepared.cardsByKey.get(profile.externalKey)
  const previousRows = owned ? prepared.rowsByCard.get(owned.id) ?? [] : []
  const isolated = {
    ...prepared.source,
    cards: owned ? [owned] : [],
    performances: previousRows.map((row) => row.performance),
    settings: { ...prepared.source.settings, proBonusEnabled: true },
  }
  let sequence = 0
  const importSource = prepared.legacyDuplicateIds
    ? { ...prepared.source, settings: { ...prepared.source.settings, proBonusEnabled: true } }
    : isolated
  const { data: imported, result: { cardId } } = importCatalogProfileIntoData(importSource, {
    ...profile,
    rarityLabel,
    passKind: isUfcCatalogSport(profile.sport) ? 'player' : profile.passKind,
  }, {
    nowIso: '2000-01-01T00:00:00Z',
    createId: (prefix) => {
      let id: string
      do { id = `__scenario-${prefix}-${sequence++}` } while (prepared.reservedIds.has(id))
      return id
    },
  })

  // Legacy backups can contain reused performance IDs. The full engine uses
  // those IDs in Pro attribution; preserve that behavior instead of guessing.
  // Normal imported collections keep the bounded incremental path below.
  if (prepared.legacyDuplicateIds) {
    const after = computeYearRollup(imported)
    const target = after.cards.find((entry) => entry.card.id === cardId)
    if (!target) return null
    const netClaimableDelta = after.totalClaimableRax - prepared.claimable
    return {
      netClaimableDelta, netGuaranteedDelta: after.totalGuaranteedRax - prepared.guaranteed,
      newClaimableRax: target.totalClaimableRax, overlapRax: target.overlapRax,
      displacedRax: Math.max(0, target.totalClaimableRax - netClaimableDelta),
    }
  }

  // Canonical import semantics run only over this card, including retained rows and previews.
  const targetOrders = new Map<string, number>()
  imported.performances.forEach((performance, index) => {
    const day = monthDayKeyFromClaimDay(performance.claimDay)
    if (!day || performance.raxEarned <= 0 || targetOrders.has(day)) return
    targetOrders.set(day, previousRows[index]?.order ?? prepared.source.performances.length + index)
  })
  const targetDays = computeClaimDayResults(imported)
  const affected = new Set(targetDays.map((day) => day.claimDay))
  for (const { performance } of previousRows) {
    const day = monthDayKeyFromClaimDay(performance.claimDay)
    if (day) affected.add(day)
  }
  const targetByDay = new Map(targetDays.map((day) => [day.claimDay, day.sports[0]?.guaranteed[0]]))
  const changed = new Map<string, Pick<ClaimDayResult, 'totalClaimableRax' | 'totalGuaranteedRax'>>()
  let newClaimableRax = 0
  let overlapRax = 0
  for (const day of affected) {
    const baseline = prepared.days.get(day)
    const target = targetByDay.get(day)
    const sportKeys = new Set(baseline?.sports.keys())
    if (target) sportKeys.add(target.card.sport)
    let totalGuaranteedRax = 0
    let targetGuaranteed = false
    const overlaps: ClaimCandidate[] = []
    for (const sport of [...sportKeys].sort((a, b) => a.localeCompare(b))) {
      const existing = baseline?.sports.get(sport)
      let result = existing?.result
      if (sport === owned?.sport || sport === target?.card.sport) {
        // Only top two + the highest overlap can affect claims. Keep a fourth
        // incumbent so removing/upgrading an owned leader still reveals the true third.
        const candidates = (existing?.candidates ?? []).slice(0, 4)
          .filter((candidate) => candidate.card.id !== cardId)
        if (target?.card.sport === sport) candidates.push({
          card: target.card, performance: target.performance, order: targetOrders.get(day)!,
        })
        // Re-sort only the changed sport, preserving original order for exact ties.
        candidates.sort((a, b) => a.order - b.order)
        result = computeSportClaim(sport, candidates)
      }
      if (!result) continue
      totalGuaranteedRax += result.totalGuaranteedRax
      // Other overlaps cannot beat this sport's first overlap for the single Pro slot.
      if (result.overlaps[0]) overlaps.push(result.overlaps[0])
      if (result.guaranteed.some((candidate) => candidate.card.id === cardId)) targetGuaranteed = true
    }
    const pro = chooseProBonus(overlaps)
    changed.set(day, { totalGuaranteedRax, totalClaimableRax: totalGuaranteedRax + (pro?.performance.raxEarned ?? 0) })
    if (target) {
      if (targetGuaranteed || pro?.card.id === cardId) {
        newClaimableRax += target.performance.raxEarned
      } else {
        overlapRax += target.performance.raxEarned
      }
    }
  }
  // Keep full-rollup reduction order, including new days, to avoid floating-point tie drift.
  const addedDays = [...affected].filter((day) => !prepared.days.has(day))
  const keys = addedDays.length
    ? [...prepared.dayKeys, ...addedDays].sort((a, b) => a.localeCompare(b))
    : prepared.dayKeys
  let claimable = 0
  let guaranteed = 0
  for (const day of keys) {
    const result = changed.get(day) ?? prepared.days.get(day)!.result
    claimable += result.totalClaimableRax
    guaranteed += result.totalGuaranteedRax
  }
  const netClaimableDelta = claimable - prepared.claimable
  return {
    netClaimableDelta,
    netGuaranteedDelta: guaranteed - prepared.guaranteed,
    newClaimableRax,
    overlapRax,
    displacedRax: Math.max(0, newClaimableRax - netClaimableDelta),
  }
}

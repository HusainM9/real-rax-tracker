import { describe, expect, it, vi } from 'vitest'
import * as claimEngine from './claimOptimizer'
import { prepareImportScenario, scoreImportScenario } from './importScenario'
import { addProfileToDataAtRarity } from './passRecommendation'
import { computeYearRollup } from './claimOptimizer'
import { createEmptyData } from './storage'
import type { CatalogImportProfile } from './catalogApi'
import type { PlayerCard, RaxPerformance, RaxTrackerData, Sport } from '../types/rax'

const timestamp = '2026-10-30T00:00:00Z'
function card(id: string, sport: Sport = 'NBA', name = id): PlayerCard {
  return { id, name, sport, season: '2025-26', externalKey: `${id}|2025|${sport}`, notes: '', createdAt: timestamp }
}
function row(cardId: string, value: number, claimDay = '2025-01-01', id = `${cardId}-${claimDay}`): RaxPerformance {
  return { id, cardId, claimDay, raxEarned: value, note: '', createdAt: timestamp }
}
function profile(sport: Sport = 'NBA', externalKey = `new|2025|${sport}`): CatalogImportProfile {
  return {
    externalKey, entityId: 900, sport, passKind: 'player', seasonYear: 2025,
    seasonLabel: '2025-26', name: 'New player', cachedAt: timestamp,
    rowCount: 1, totalBaseRax: 1, rows: [{ claimDay: '2025-01-01', baseRaxEarned: 1 }],
  }
}
function reference(data: RaxTrackerData, candidate: CatalogImportProfile, rarity: string) {
  const pro = { ...data, settings: { ...data.settings, proBonusEnabled: true } }
  const before = computeYearRollup(pro)
  const afterData = addProfileToDataAtRarity(pro, candidate, rarity)
  const after = computeYearRollup(afterData)
  const target = after.cards.find((entry) => entry.card.externalKey === candidate.externalKey)!
  const netClaimableDelta = after.totalClaimableRax - before.totalClaimableRax
  return {
    netClaimableDelta,
    netGuaranteedDelta: after.totalGuaranteedRax - before.totalGuaranteedRax,
    newClaimableRax: target.totalClaimableRax,
    overlapRax: target.overlapRax,
    displacedRax: Math.max(0, target.totalClaimableRax - netClaimableDelta),
  }
}
function expectReference(data: RaxTrackerData, candidate: CatalogImportProfile, rarity = 'Iconic 1') {
  const expected = reference(data, candidate, rarity)
  const actual = scoreImportScenario(prepareImportScenario(data), candidate, rarity)!
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    expect(actual[key], key).toBeCloseTo(expected[key], 8)
  }
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

describe('prepared import scenarios', () => {
  it('preserves full-engine behavior for legacy rows with duplicate performance IDs', () => {
    const cards = ['a', 'b', 'c', 'owned'].map((id) => card(id))
    const data = { ...createEmptyData(), cards,
      performances: [row('a', 100), row('b', 90), row('c', 80, '2025-01-01', 'shared-id'), row('owned', 40, '2025-01-01', 'shared-id')] }
    expectReference(data, { ...profile('NBA', cards[3]!.externalKey), rows: [{ claimDay: '2025-01-01', baseRaxEarned: 0.2 }] })
  })

  it('reuses unaffected sport ladders and limits changed sport ranking to possible top-three contenders', () => {
    const cards = Array.from({ length: 80 }, (_, index) => card(`p${index}`))
    const data = { ...createEmptyData(), cards, performances: cards.map((item, index) => row(item.id, 800 - index * 10)) }
    const candidate = { ...profile('NBA', cards[0]!.externalKey), rows: [{ claimDay: '2025-01-01', baseRaxEarned: 0.1 }] }
    const expected = reference(data, candidate, 'Iconic 1')
    const prepared = prepareImportScenario(data)
    const rankSport = vi.spyOn(claimEngine, 'computeSportClaim')
    try {
      expect(scoreImportScenario(prepared, candidate, 'Iconic 1')).toEqual(expected)
      expect(rankSport).toHaveBeenCalled()
      expect(Math.max(...rankSport.mock.calls.map((call) => call[1].length))).toBeLessThanOrEqual(5)
    } finally {
      rankSport.mockRestore()
    }
  })

  it('scores a new pass against guaranteed and Pro positions, not gross earnings alone', () => {
    const data = { ...createEmptyData(), cards: [card('a'), card('b'), card('c')],
      performances: [row('a', 100), row('b', 90), row('c', 80)] }
    expect(scoreImportScenario(prepareImportScenario(data), profile(), 'Iconic 1')).toMatchObject({
      netClaimableDelta: 70, netGuaranteedDelta: 60, newClaimableRax: 150, overlapRax: 0, displacedRax: 80,
    })
  })

  it('retains owned rows absent from incoming data, including existing preview rarity', () => {
    const owned = { ...card('owned'), rarityLabel: 'Legendary 1', simulatedRarityLabel: 'Iconic 20' }
    const data = { ...createEmptyData(), cards: [owned, card('a'), card('b'), card('c')],
      performances: [{ ...row('owned', 50), baseRaxEarned: 2 }, row('a', 200), row('b', 150), row('c', 100)] }
    const candidate = { ...profile('NBA', owned.externalKey), rows: [{ claimDay: '2025-01-02', baseRaxEarned: 3 }] }
    expectReference(data, candidate)
    expect(scoreImportScenario(prepareImportScenario(data), candidate, 'Iconic 1')).toMatchObject({
      netClaimableDelta: 750, newClaimableRax: 1250,
    })
  })

  it('preserves stable ties when an earlier owned card changes its earnings', () => {
    const data = { ...createEmptyData(), cards: [card('a', 'NBA', 'Same'), card('b', 'NBA', 'Same'), card('c', 'NBA', 'Same'), card('d', 'NBA', 'Same')],
      performances: [row('a', 25), row('b', 150), row('c', 150), row('d', 150)] }
    const candidate = { ...profile('NBA', data.cards[0]!.externalKey), name: 'Same' }
    expectReference(data, candidate)
    expect(scoreImportScenario(prepareImportScenario(data), candidate, 'Iconic 1')?.newClaimableRax).toBe(150)
  })

  it('handles duplicate incoming dates, old duplicate rows and multiple years on one claim day', () => {
    const owned = card('owned')
    const data = { ...createEmptyData(), cards: [owned, card('other')],
      performances: [row('owned', 20), row('owned', 200, '2025-01-01', 'duplicate'), row('owned', 100, '2024-01-01'), row('other', 1000)] }
    const candidate = { ...profile('NBA', owned.externalKey), rows: [
      { claimDay: '2025-01-01', baseRaxEarned: 1 }, { claimDay: '2025-01-01', baseRaxEarned: 3 },
    ] }
    expectReference(data, candidate)
  })

  it('sums UFC fights and moves Pro between sports', () => {
    const data = { ...createEmptyData(), cards: [card('nba1'), card('nba2'), card('nba3'), card('u1', 'UFC'), card('u2', 'UFC'), card('u3', 'UFC')],
      performances: [row('nba1', 100), row('nba2', 90), row('nba3', 80), row('u1', 120), row('u2', 110), row('u3', 60)] }
    const candidate = { ...profile('UFC'), passKind: 'team' as const, rows: [
      { claimDay: '2024-01-01', baseRaxEarned: 5 }, { claimDay: '2025-01-01', baseRaxEarned: 5 },
    ] }
    expectReference(data, candidate)
  })

  it('handles team caps, changed sport metadata, missing days and empty collections', () => {
    const data = { ...createEmptyData(), cards: [card('owned')], performances: [row('owned', 500), row('owned', 75, '2025-02-01')] }
    expectReference(data, { ...profile('NHL', data.cards[0]!.externalKey), passKind: 'team' }, 'Legendary 1')
    expectReference(createEmptyData(), profile(), 'Mystic 10')
  })

  it('does not mutate its collection, profiles or prepared baseline between scores', () => {
    const data = deepFreeze({ ...createEmptyData(), cards: [card('a')], performances: [row('a', 100)] })
    const candidate = deepFreeze(profile())
    const prepared = prepareImportScenario(data)
    const first = scoreImportScenario(prepared, candidate, 'Iconic 1')
    scoreImportScenario(prepared, { ...candidate, name: 'Other', rows: [{ claimDay: '2025-02-01', baseRaxEarned: 4 }] }, 'Iconic 20')
    expect(scoreImportScenario(prepared, candidate, 'Iconic 1')).toEqual(first)
    const changed = { ...data, cards: [...data.cards, card('b'), card('c')],
      performances: [...data.performances, row('b', 200), row('c', 190)] }
    expect(scoreImportScenario(prepareImportScenario(changed), candidate, 'Iconic 1')).not.toEqual(first)
  })

  it('returns no scenario for an empty imported series', () => {
    expect(scoreImportScenario(prepareImportScenario(createEmptyData()), { ...profile(), rows: [] }, 'Iconic 1')).toBeNull()
  })

  it('matches complete recomputation across deterministic mixed-sport scenarios', () => {
    const sports: Sport[] = ['NBA', 'NHL', 'NFL', 'UFC']
    for (let seed = 1; seed <= 64; seed++) {
      let state = seed
      const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000 }
      const cards = Array.from({ length: 20 }, (_, index) => ({
        ...card(`p${index}`, sports[index % sports.length]!, `Name ${index % 3}`),
        rarityLabel: 'Legendary 1', ...(index % 5 === 0 ? { simulatedRarityLabel: 'Iconic 5' } : {}),
      }))
      const performances = cards.flatMap((item, index) => Array.from({ length: 5 }, (_, day) => ({
        ...row(item.id, Math.ceil(random() * 200), `202${day % 2 + 4}-0${day % 2 + 1}-0${day % 3 + 1}`, `${index}-${day}`),
        ...(day % 2 === 0 ? { baseRaxEarned: Math.ceil(random() * 10) } : {}),
      })))
      const data = { ...createEmptyData(), cards, performances }
      const owned = cards[seed % cards.length]!
      const candidate = { ...profile(owned.sport, seed % 2 ? owned.externalKey : undefined), name: seed % 3 ? 'New' : owned.name,
        rows: Array.from({ length: 4 }, (_, day) => ({ claimDay: `202${day % 2 + 4}-0${day % 2 + 1}-0${day % 3 + 1}`, baseRaxEarned: Math.ceil(random() * 12) })) }
      expectReference(data, candidate, seed % 2 ? 'Iconic 1' : 'Mystic 10')
    }
  })
})

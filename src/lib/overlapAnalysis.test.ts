import { describe, expect, it } from 'vitest'
import { computeClaimDayResults } from './claimOptimizer'
import {
  getSportsWithOverlaps,
  listAllOverlapDays,
  listSportOverlapDays,
  sortSportOverlapDays,
} from './overlapAnalysis'
import type { PlayerCard, RaxPerformance, RaxTrackerData } from '../types/rax'

function card(id: string, name: string, sport: PlayerCard['sport']): PlayerCard {
  return {
    id,
    name,
    sport,
    season: '2025-26',
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function perf(
  id: string,
  cardId: string,
  raxEarned: number,
  claimDay: string,
): RaxPerformance {
  return {
    id,
    cardId,
    claimDay,
    raxEarned,
    note: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('overlapAnalysis', () => {
  const data: RaxTrackerData = {
    version: 1,
    settings: { proBonusEnabled: false, savedUsername: '' },
    cards: [
      card('c1', 'Alpha', 'NBA'),
      card('c2', 'Bravo', 'NBA'),
      card('c3', 'Charlie', 'NBA'),
      card('c4', 'Delta', 'NFL'),
      card('c5', 'Echo', 'NFL'),
      card('c6', 'Foxtrot', 'NFL'),
    ],
    performances: [
      perf('p1', 'c1', 30, '2026-03-01'),
      perf('p2', 'c2', 25, '2026-03-01'),
      perf('p3', 'c3', 10, '2026-03-01'),
      perf('p4', 'c1', 50, '2026-02-01'),
      perf('p5', 'c2', 45, '2026-02-01'),
      perf('p6', 'c3', 40, '2026-02-01'),
      perf('p7', 'c1', 8, '2026-03-15'),
      perf('p8', 'c2', 7, '2026-03-15'),
      perf('p9', 'c3', 6, '2026-03-15'),
      perf('p10', 'c4', 20, '2026-04-01'),
      perf('p11', 'c5', 18, '2026-04-01'),
      perf('p12', 'c6', 5, '2026-04-01'),
    ],
    potentialCards: [],
  }

  const results = computeClaimDayResults(data)

  it('lists sports that have overlaps', () => {
    expect(getSportsWithOverlaps(results)).toEqual(['NBA', 'NFL'])
  })

  it('sorts overlap days by overlap rax then date', () => {
    const nbaDays = listSportOverlapDays(results, 'NBA')
    const sorted = sortSportOverlapDays(nbaDays)
    expect(sorted.map((row) => row.claimDay)).toEqual(['02-01', '03-01', '03-15'])
    expect(sorted[0]?.sportOverlapRax).toBe(40)
  })

  it('lists overlap days across all sports', () => {
    const allDays = listAllOverlapDays(results)
    expect(allDays).toHaveLength(4)
    expect(allDays.map((row) => `${row.sport}:${row.claimDay}`)).toEqual([
      'NBA:02-01',
      'NBA:03-01',
      'NBA:03-15',
      'NFL:04-01',
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { computeClaimDayResults } from './claimOptimizer'
import { buildCalendarCells, findClaimDayResult, groupClaimDaysByMonth } from './calendarView'
import type { PlayerCard, RaxPerformance, RaxTrackerData } from '../types/rax'

function card(id: string): PlayerCard {
  return {
    id,
    name: `Player ${id}`,
    sport: 'NBA',
    season: '2025-26',
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function perf(id: string, cardId: string, claimDay: string, raxEarned: number): RaxPerformance {
  return {
    id,
    cardId,
    claimDay,
    raxEarned,
    note: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('calendarView', () => {
  const data: RaxTrackerData = {
    version: 1,
    settings: { proBonusEnabled: false, savedUsername: '' },
    cards: [card('c1'), card('c2')],
    performances: [
      perf('p1', 'c1', '2025-01-15', 100),
      perf('p2', 'c2', '2026-01-15', 200),
    ],
    potentialCards: [],
    savedCardProfiles: [],
  }

  const results = computeClaimDayResults(data)

  it('groups OTD days by calendar month', () => {
    expect(groupClaimDaysByMonth(results).map((group) => group.month)).toEqual(['January'])
    expect(results).toHaveLength(1)
    expect(results[0]?.claimDay).toBe('01-15')
  })

  it('shows one claimable total per OTD day on the calendar cell', () => {
    const january = groupClaimDaysByMonth(results)[0]!
    const cells = buildCalendarCells(january.days, january.monthIdx, 2026)
    const day15 = cells.find((cell) => cell.dayNumber === 15)
    expect(day15?.result?.totalClaimableRax).toBe(300)
    expect(findClaimDayResult(results, '01-15')?.totalClaimableRax).toBe(300)
  })
})

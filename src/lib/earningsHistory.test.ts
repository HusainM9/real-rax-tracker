import { beforeEach, describe, expect, it } from 'vitest'
import {
  filterEarningsHistory,
  weeklyEarningsTotals,
  highestAverageWeekday,
  highestEarningDay,
  rankEarningPasses,
  rankEarningSports,
  readEarningsHistory,
  replaceEarningsHistoryForUsernames,
  saveEarningsHistoryEntries,
  type EarningsHistoryEntry,
} from './earningsHistory'

beforeEach(() => localStorage.clear())

const history: EarningsHistoryEntry[] = [
  {
    username: 'alpha',
    day: '2026-10-05', // Monday
    dailyTotal: 100,
    capturedAt: '',
    passes: [
      { username: 'alpha', id: '1', label: 'Player One', sport: 'NFL', totalEarnings: 70 },
      { username: 'alpha', id: '2', label: 'Player Two', sport: 'NBA', totalEarnings: 30 },
    ],
  },
  {
    username: 'alpha',
    day: '2026-10-06', // Tuesday
    dailyTotal: 240,
    capturedAt: '',
    passes: [
      { username: 'alpha', id: '1', label: 'Player One', sport: 'NFL', totalEarnings: 40 },
      { username: 'alpha', id: '2', label: 'Player Two', sport: 'NBA', totalEarnings: 200 },
    ],
  },
  {
    username: 'alpha',
    day: '2026-10-12', // Monday
    dailyTotal: 300,
    capturedAt: '',
    passes: [
      { username: 'alpha', id: '1', label: 'Player One', sport: 'NFL', totalEarnings: 300 },
    ],
  },
]

describe('earnings report statistics', () => {
  it('groups long history into Monday-based totals without losing earnings', () => {
    expect(weeklyEarningsTotals(history)).toEqual([
      { day: '2026-10-05', dailyTotal: 340 },
      { day: '2026-10-12', dailyTotal: 300 },
    ])
  })
  it('filters inclusive date ranges and carries player avatars through rankings', () => {
    const rows = filterEarningsHistory(history, '2026-10-06', '2026-10-12')
    expect(rows.map((row) => row.day)).toEqual(['2026-10-06', '2026-10-12'])
    expect(filterEarningsHistory(history, '2026-10-12', '2026-10-06')).toEqual([])
    const enriched = [{ ...history[0]!, passes: history[0]!.passes.map((pass) => ({ ...pass, avatar: 'player-face' })) }]
    expect(rankEarningPasses(enriched)[0]?.avatar).toBe('player-face')
  })
  it('finds the highest earned day', () => {
    expect(highestEarningDay(history)?.day).toBe('2026-10-12')
  })

  it('compares weekdays by average rather than total', () => {
    expect(highestAverageWeekday(history)).toMatchObject({
      weekday: 'Tuesday',
      average: 240,
      days: 1,
    })
  })

  it('ranks passes by earnings accumulated across tracked days', () => {
    expect(rankEarningPasses(history)).toEqual([
      { username: 'alpha', label: 'Player One', sport: 'NFL', total: 410, best: 300, days: 3 },
      { username: 'alpha', label: 'Player Two', sport: 'NBA', total: 230, best: 200, days: 2 },
    ])
  })

  it('ranks sports by tracked earnings with day and pass statistics', () => {
    expect(rankEarningSports(history)).toEqual([
      {
        sport: 'NFL',
        total: 410,
        best: 300,
        average: 410 / 3,
        days: 3,
        passes: 1,
      },
      {
        sport: 'NBA',
        total: 230,
        best: 200,
        average: 115,
        days: 2,
        passes: 1,
      },
    ])
  })

  it('combines sport labels case-insensitively and keeps accounts distinct', () => {
    expect(rankEarningSports([
      history[0]!,
      {
        ...history[0]!,
        username: 'beta',
        passes: [
          { username: 'beta', id: '1', label: 'Another player', sport: 'nfl', totalEarnings: 20 },
        ],
      },
    ])).toEqual([
      {
        sport: 'NFL',
        total: 90,
        best: 90,
        average: 90,
        days: 1,
        passes: 2,
      },
      {
        sport: 'NBA',
        total: 30,
        best: 30,
        average: 30,
        days: 1,
        passes: 1,
      },
    ])
  })

  it('merges authoritative snapshots without deleting locally refreshed days', () => {
    saveEarningsHistoryEntries([
      history[0]!,
      { ...history[1]!, username: 'beta' },
    ])

    const scheduled = { ...history[2]!, dailyTotal: 325 }
    replaceEarningsHistoryForUsernames([scheduled], ['alpha'])

    expect(readEarningsHistory()).toEqual([
      history[0]!,
      { ...history[1]!, username: 'beta' },
      scheduled,
    ])
  })
})

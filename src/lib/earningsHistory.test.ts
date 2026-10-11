import { beforeEach, describe, expect, it } from 'vitest'
import {
  highestAverageWeekday,
  highestEarningDay,
  rankEarningPasses,
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

  it('replaces live local rows with authoritative scheduled snapshots', () => {
    saveEarningsHistoryEntries([
      history[0]!,
      { ...history[1]!, username: 'beta' },
    ])

    const scheduled = { ...history[2]!, dailyTotal: 325 }
    replaceEarningsHistoryForUsernames([scheduled], ['alpha'])

    expect(readEarningsHistory()).toEqual([
      { ...history[1]!, username: 'beta' },
      scheduled,
    ])
  })
})

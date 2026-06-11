import { describe, expect, it } from 'vitest'
import { reconcileDailyRowsToPassTotal } from './meowbotCatalogStore'

describe('reconcileDailyRowsToPassTotal', () => {
  it('keeps rows unchanged when daily sum matches stored total', () => {
    const rows = [
      { claimDay: '2024-01-01', baseRaxEarned: 10 },
      { claimDay: '2024-01-02', baseRaxEarned: 15 },
    ]
    const result = reconcileDailyRowsToPassTotal(25, rows)
    expect(result.totalBaseRax).toBe(25)
    expect(result.rows).toEqual(rows)
  })

  it('scales inflated daily rows down to stored pass total', () => {
    const rows = [
      { claimDay: '2024-01-01', baseRaxEarned: 48.15 },
      { claimDay: '2024-01-02', baseRaxEarned: 48.15 },
    ]
    const result = reconcileDailyRowsToPassTotal(44, rows)
    expect(result.totalBaseRax).toBe(44)
    expect(result.rows[0]?.baseRaxEarned).toBeCloseTo(22, 5)
    expect(result.rows[1]?.baseRaxEarned).toBeCloseTo(22, 5)
    expect(result.rows.reduce((sum, row) => sum + row.baseRaxEarned, 0)).toBeCloseTo(44, 5)
  })

  it('scales deflated daily rows up to stored pass total', () => {
    const rows = [{ claimDay: '2024-01-01', baseRaxEarned: 20 }]
    const result = reconcileDailyRowsToPassTotal(40, rows)
    expect(result.totalBaseRax).toBe(40)
    expect(result.rows[0]?.baseRaxEarned).toBeCloseTo(40, 5)
  })

  it('returns stored total when there are no daily rows', () => {
    const result = reconcileDailyRowsToPassTotal(440, [])
    expect(result.totalBaseRax).toBe(440)
    expect(result.rows).toEqual([])
  })
})

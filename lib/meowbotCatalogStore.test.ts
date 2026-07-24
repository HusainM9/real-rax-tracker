import { describe, expect, it } from 'vitest'
import {
  catalogDailyEarningsReplaceKeys,
  reconcileDailyRowsToPassTotal,
  type CatalogDailyEarningInput,
  type CatalogPassInput,
} from './meowbotCatalogStore'
import { resolveCatalogPassSeasonYear } from './seasonClaimWindow'

describe('resolveCatalogPassSeasonYear', () => {
  it('maps NFL split-season labels to Real start-year season_year values', () => {
    expect(resolveCatalogPassSeasonYear(2024, '2024-25', 'NFL')).toBe(2024)
    expect(resolveCatalogPassSeasonYear(2025, '2024-25', 'NFL')).toBe(2024)
  })
})

describe('catalogDailyEarningsReplaceKeys', () => {
  const staffordPass: CatalogPassInput = {
    externalKey: '100|2024|NFL',
    entityId: 100,
    passKind: 'player',
    sport: 'NFL',
    seasonYear: 2024,
    seasonLabel: '2024-25',
    name: 'Matthew Stafford',
  }

  it('does not mark passes for replacement when the import batch has no daily rows for them', () => {
    const keys = catalogDailyEarningsReplaceKeys([staffordPass], [])
    expect(keys).toEqual([])
  })

  it('marks only passes that receive filtered daily rows', () => {
    const rows: CatalogDailyEarningInput[] = [
      { externalKey: '100|2024|NFL', claimDay: '2024-09-10', baseRaxEarned: 21 },
      { externalKey: '200|2025|NFL', claimDay: '2025-09-08', baseRaxEarned: 12 },
    ]
    const henryPass: CatalogPassInput = {
      ...staffordPass,
      externalKey: '200|2025|NFL',
      entityId: 200,
      seasonYear: 2025,
      seasonLabel: '2025-26',
      name: 'Derrick Henry',
    }
    expect(catalogDailyEarningsReplaceKeys([staffordPass, henryPass], rows)).toEqual([
      '100|2024|NFL',
      '200|2025|NFL',
    ])
  })
})

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

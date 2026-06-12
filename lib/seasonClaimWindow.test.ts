import { describe, expect, it } from 'vitest'
import {
  claimDayInPassSeason,
  filterDailyRowsToPassSeason,
  passSeasonDateWindow,
  canonicalCatalogPassMetadata,
  expectedSeasonLabelFromYear,
  isCatalogSeasonMetadataAligned,
  resolveCatalogPassSeasonYear,
} from './seasonClaimWindow'

describe('passSeasonDateWindow', () => {
  it('uses end-year windows for NFL', () => {
    expect(passSeasonDateWindow(2025, 'NFL')).toEqual({
      start: '2024-08-01',
      end: '2025-04-30',
    })
  })

  it('uses end-year windows for NHL through Stanley Cup playoffs in June', () => {
    expect(passSeasonDateWindow(2024, 'NHL')).toEqual({
      start: '2023-08-01',
      end: '2024-06-30',
    })
  })

  it('uses start-year windows for CBB', () => {
    expect(passSeasonDateWindow(2024, 'CBB')).toEqual({
      start: '2024-08-01',
      end: '2025-06-30',
    })
  })
})

describe('claimDayInPassSeason', () => {
  it('keeps 2024-25 NFL games and drops other seasons', () => {
    expect(claimDayInPassSeason('2024-11-26', 2025, 'NFL')).toBe(true)
    expect(claimDayInPassSeason('2025-01-19', 2025, 'NFL')).toBe(true)
    expect(claimDayInPassSeason('2023-11-26', 2025, 'NFL')).toBe(false)
    expect(claimDayInPassSeason('2023-01-22', 2025, 'NFL')).toBe(false)
    expect(claimDayInPassSeason('2023-09-10', 2025, 'NFL')).toBe(false)
  })

  it('keeps 2023-24 NFL games on the 2024 pass', () => {
    expect(claimDayInPassSeason('2023-11-26', 2024, 'NFL')).toBe(true)
    expect(claimDayInPassSeason('2024-02-11', 2024, 'NFL')).toBe(true)
    expect(claimDayInPassSeason('2022-12-11', 2024, 'NFL')).toBe(false)
  })

  it('uses season_label when season_year is mismatched in catalog metadata', () => {
    expect(claimDayInPassSeason('2023-09-10', 2024, 'NFL', '2024-25')).toBe(false)
    expect(claimDayInPassSeason('2024-09-08', 2024, 'NFL', '2024-25')).toBe(true)
    expect(claimDayInPassSeason('2025-01-19', 2024, 'NFL', '2024-25')).toBe(true)
  })

  it('keeps NHL playoff claim days in May and June on the correct pass', () => {
    expect(claimDayInPassSeason('2024-05-15', 2024, 'NHL', '2023-24')).toBe(true)
    expect(claimDayInPassSeason('2024-06-18', 2024, 'NHL', '2023-24')).toBe(true)
    expect(claimDayInPassSeason('2024-07-01', 2024, 'NHL', '2023-24')).toBe(false)
    expect(claimDayInPassSeason('2023-05-15', 2024, 'NHL', '2023-24')).toBe(false)
  })
})

describe('expectedSeasonLabelFromYear', () => {
  it('maps season_year 2024 per sport encoding rules', () => {
    expect(expectedSeasonLabelFromYear(2024, 'NFL')).toBe('2023-24')
    expect(expectedSeasonLabelFromYear(2024, 'NBA')).toBe('2023-24')
    expect(expectedSeasonLabelFromYear(2024, 'CBB')).toBe('2024-25')
    expect(expectedSeasonLabelFromYear(2024, 'MLB')).toBe('2024')
  })
})

describe('isCatalogSeasonMetadataAligned', () => {
  it('accepts valid NFL 2023-24 metadata', () => {
    expect(isCatalogSeasonMetadataAligned(2024, '2023-24', 'NFL')).toBe(true)
  })

  it('flags NFL 2024-25 metadata stored on season_year 2024', () => {
    expect(isCatalogSeasonMetadataAligned(2024, '2024-25', 'NFL')).toBe(false)
  })

  it('flags NHL 2023-24 metadata stored on season_year 2023 (22-23 collision)', () => {
    expect(isCatalogSeasonMetadataAligned(2023, '2023-24', 'NHL')).toBe(false)
    expect(isCatalogSeasonMetadataAligned(2024, '2023-24', 'NHL')).toBe(true)
  })

  it('accepts valid CBB 2024-25 metadata on season_year 2024', () => {
    expect(isCatalogSeasonMetadataAligned(2024, '2024-25', 'CBB')).toBe(true)
  })
})

describe('canonicalCatalogPassMetadata', () => {
  it('repairs NFL pass metadata from label', () => {
    expect(
      canonicalCatalogPassMetadata({
        entityId: 607,
        sport: 'NFL',
        seasonYear: 2024,
        seasonLabel: '2024-25',
      }),
    ).toEqual({
      seasonYear: 2025,
      seasonLabel: '2024-25',
      externalKey: '607|2025|NFL',
      aligned: false,
    })
  })

  it('repairs NHL Trocheck-style collision metadata from label', () => {
    expect(
      canonicalCatalogPassMetadata({
        entityId: 999,
        sport: 'NHL',
        seasonYear: 2023,
        seasonLabel: '2023-24',
      }),
    ).toEqual({
      seasonYear: 2024,
      seasonLabel: '2023-24',
      externalKey: '999|2024|NHL',
      aligned: false,
    })
  })
})

describe('resolveCatalogPassSeasonYear', () => {
  it('maps NFL split-season labels to Real end-year season_year values', () => {
    expect(resolveCatalogPassSeasonYear(2024, '2023-24', 'NFL')).toBe(2024)
    expect(resolveCatalogPassSeasonYear(2024, '2024-25', 'NFL')).toBe(2025)
  })
})

describe('college sports (CBB/CFB) — start-year encoding', () => {
  const cbbPass = {
    entityId: 42,
    sport: 'CBB',
    seasonYear: 2024,
    seasonLabel: '2024-25',
  }

  it('treats season_year 2024 as 2024-25 (not 2023-24)', () => {
    expect(resolveCatalogPassSeasonYear(2024, '2024-25', 'CBB')).toBe(2024)
    expect(expectedSeasonLabelFromYear(2024, 'CBB')).toBe('2024-25')
    expect(isCatalogSeasonMetadataAligned(2024, '2024-25', 'CBB')).toBe(true)
    expect(isCatalogSeasonMetadataAligned(2024, '2024-25', 'CFB')).toBe(true)
  })

  it('does not rewrite already-correct college pass metadata on upsert', () => {
    expect(canonicalCatalogPassMetadata(cbbPass)).toEqual({
      seasonYear: 2024,
      seasonLabel: '2024-25',
      externalKey: '42|2024|CBB',
      aligned: true,
    })
  })

  it('keeps in-season college game dates and only drops prior-season noise', () => {
    const rows = [
      { claimDay: '2024-11-15', baseRaxEarned: 10 },
      { claimDay: '2025-03-01', baseRaxEarned: 12 },
      { claimDay: '2023-11-26', baseRaxEarned: 99 },
    ]
    expect(filterDailyRowsToPassSeason(rows, 2024, 'CBB', '2024-25')).toEqual([
      { claimDay: '2024-11-15', baseRaxEarned: 10 },
      { claimDay: '2025-03-01', baseRaxEarned: 12 },
    ])
  })
})

describe('end-year pro sports with clean catalog metadata (NBA/FC)', () => {
  it('accepts NBA 2023-24 on season_year 2024', () => {
    expect(isCatalogSeasonMetadataAligned(2024, '2023-24', 'NBA')).toBe(true)
    expect(
      canonicalCatalogPassMetadata({
        entityId: 1,
        sport: 'NBA',
        seasonYear: 2024,
        seasonLabel: '2023-24',
      }).aligned,
    ).toBe(true)
  })

  it('accepts FC 2023-24 on season_year 2024', () => {
    expect(isCatalogSeasonMetadataAligned(2024, '2023-24', 'FC')).toBe(true)
  })
})

describe('filterDailyRowsToPassSeason', () => {
  it('removes out-of-season rows before catalog upsert', () => {
    const rows = [
      { claimDay: '2024-09-08', baseRaxEarned: 12 },
      { claimDay: '2023-11-26', baseRaxEarned: 99 },
      { claimDay: '2025-01-19', baseRaxEarned: 18 },
    ]
    expect(filterDailyRowsToPassSeason(rows, 2025, 'NFL')).toEqual([
      { claimDay: '2024-09-08', baseRaxEarned: 12 },
      { claimDay: '2025-01-19', baseRaxEarned: 18 },
    ])
  })
})

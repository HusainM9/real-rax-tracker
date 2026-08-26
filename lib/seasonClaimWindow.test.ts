import { describe, expect, it } from 'vitest'
import {
  catalogExternalKeyCandidates,
  claimDayInPassSeason,
  filterDailyRowsToPassSeason,
  passSeasonDateWindow,
  canonicalCatalogPassMetadata,
  expectedSeasonLabelFromYear,
  importSeasonLabelForCatalog,
  isCatalogSeasonMetadataAligned,
  ownershipImportSeasonLabel,
  resolveCatalogPassSeasonYear,
  seasonYearKindForSport,
} from './seasonClaimWindow'

describe('seasonYearKindForSport', () => {
  it('matches live Real season + seasonDisplay encoding', () => {
    expect(seasonYearKindForSport('NFL')).toBe('start')
    expect(seasonYearKindForSport('NHL')).toBe('end')
    expect(seasonYearKindForSport('CFB')).toBe('start')
    expect(seasonYearKindForSport('FC')).toBe('start')
    expect(seasonYearKindForSport('NBA')).toBe('end')
    expect(seasonYearKindForSport('CBB')).toBe('end')
    expect(seasonYearKindForSport('ncaam')).toBe('end')
    expect(seasonYearKindForSport('MLB')).toBe('calendar')
    expect(seasonYearKindForSport('WNBA')).toBe('calendar')
    expect(seasonYearKindForSport('Golf')).toBe('calendar')
    expect(seasonYearKindForSport('UFC')).toBe('calendar')
  })
})

describe('passSeasonDateWindow', () => {
  it('uses start-year windows for NFL through the Super Bowl window in April', () => {
    expect(passSeasonDateWindow(2024, 'NFL')).toEqual({
      start: '2024-08-01',
      end: '2025-04-30',
    })
  })

  it('uses end-year windows for NHL through Stanley Cup playoffs in June', () => {
    expect(passSeasonDateWindow(2026, 'NHL')).toEqual({
      start: '2025-08-01',
      end: '2026-06-30',
    })
  })

  it('uses end-year windows for CBB', () => {
    expect(passSeasonDateWindow(2025, 'CBB')).toEqual({
      start: '2024-08-01',
      end: '2025-06-30',
    })
  })
})

describe('claimDayInPassSeason', () => {
  it('keeps 2024-25 NFL games and drops other seasons', () => {
    expect(claimDayInPassSeason('2024-11-26', 2024, 'NFL')).toBe(true)
    expect(claimDayInPassSeason('2025-01-19', 2024, 'NFL')).toBe(true)
    expect(claimDayInPassSeason('2023-11-26', 2024, 'NFL')).toBe(false)
    expect(claimDayInPassSeason('2023-01-22', 2024, 'NFL')).toBe(false)
    expect(claimDayInPassSeason('2023-09-10', 2024, 'NFL')).toBe(false)
  })

  it('keeps 2023-24 NFL games on the 2023 pass', () => {
    expect(claimDayInPassSeason('2023-11-26', 2023, 'NFL')).toBe(true)
    expect(claimDayInPassSeason('2024-02-11', 2023, 'NFL')).toBe(true)
    expect(claimDayInPassSeason('2022-12-11', 2023, 'NFL')).toBe(false)
  })

  it('uses season_label when season_year is mismatched in catalog metadata', () => {
    expect(claimDayInPassSeason('2023-09-10', 2025, 'NFL', '2024-25')).toBe(false)
    expect(claimDayInPassSeason('2024-09-08', 2025, 'NFL', '2024-25')).toBe(true)
    expect(claimDayInPassSeason('2025-01-19', 2025, 'NFL', '2024-25')).toBe(true)
  })

  it('keeps NHL playoff claim days in May and June on the correct pass', () => {
    expect(claimDayInPassSeason('2024-05-15', 2024, 'NHL', '2023-24')).toBe(true)
    expect(claimDayInPassSeason('2024-06-18', 2024, 'NHL', '2023-24')).toBe(true)
    expect(claimDayInPassSeason('2024-07-01', 2024, 'NHL', '2023-24')).toBe(false)
    expect(claimDayInPassSeason('2023-05-15', 2024, 'NHL', '2023-24')).toBe(false)
  })
})

describe('expectedSeasonLabelFromYear', () => {
  it('maps every sport using its own season_year convention', () => {
    expect(expectedSeasonLabelFromYear(2024, 'NFL')).toBe('2024-25')
    expect(expectedSeasonLabelFromYear(2025, 'CFB')).toBe('2025-26')
    expect(expectedSeasonLabelFromYear(2025, 'FC')).toBe('2025-26')
    expect(expectedSeasonLabelFromYear(2026, 'NBA')).toBe('2025-26')
    expect(expectedSeasonLabelFromYear(2026, 'NHL')).toBe('2025-26')
    expect(expectedSeasonLabelFromYear(2026, 'CBB')).toBe('2025-26')
    expect(expectedSeasonLabelFromYear(2026, 'MLB')).toBe('2026')
    expect(expectedSeasonLabelFromYear(2026, 'WNBA')).toBe('2026')
    expect(expectedSeasonLabelFromYear(2026, 'Golf')).toBe('2026')
    expect(expectedSeasonLabelFromYear(2023, 'UFC')).toBe('2023')
  })
})

describe('ownershipImportSeasonLabel', () => {
  it('keeps Meowbot OTD labels even when catalog canonicalization would rewrite them', () => {
    expect(ownershipImportSeasonLabel('NFL', 2024, '2024-25')).toBe('2024-25')
    expect(importSeasonLabelForCatalog('NFL', 2024, '2024-25')).toBe('2024-25')
    expect(ownershipImportSeasonLabel('NFL', 2025, '2024-25')).toBe('2024-25')
    expect(ownershipImportSeasonLabel('NHL', 2023, '2023-24')).toBe('2023-24')
  })

  it('falls back to season_year encoding when OTD label is missing', () => {
    expect(ownershipImportSeasonLabel('NFL', 2024, undefined)).toBe('2024-25')
    expect(ownershipImportSeasonLabel('Golf', 2025, undefined)).toBe('2025')
  })
})

describe('isCatalogSeasonMetadataAligned', () => {
  it('accepts valid NFL 2024-25 metadata on season_year 2024', () => {
    expect(isCatalogSeasonMetadataAligned(2024, '2024-25', 'NFL')).toBe(true)
  })

  it('flags NFL 2023-24 metadata stored on season_year 2024', () => {
    expect(isCatalogSeasonMetadataAligned(2024, '2023-24', 'NFL')).toBe(false)
  })

  it('accepts NHL end-year metadata and rejects the shifted start-year pairing', () => {
    expect(isCatalogSeasonMetadataAligned(2024, '2023-24', 'NHL')).toBe(true)
    expect(isCatalogSeasonMetadataAligned(2023, '2023-24', 'NHL')).toBe(false)
  })

  it('accepts valid CBB 2024-25 metadata on season_year 2025', () => {
    expect(isCatalogSeasonMetadataAligned(2025, '2024-25', 'CBB')).toBe(true)
  })
})

describe('canonicalCatalogPassMetadata', () => {
  it('keeps already-correct NFL start-year metadata', () => {
    expect(
      canonicalCatalogPassMetadata({
        entityId: 607,
        sport: 'NFL',
        seasonYear: 2024,
        seasonLabel: '2024-25',
      }),
    ).toEqual({
      seasonYear: 2024,
      seasonLabel: '2024-25',
      externalKey: '607|2024|NFL',
      aligned: true,
    })
  })

  it('keeps NHL 2023-24 on end-year season_year 2024', () => {
    expect(
      canonicalCatalogPassMetadata({
        entityId: 999,
        sport: 'NHL',
        seasonYear: 2024,
        seasonLabel: '2023-24',
      }),
    ).toEqual({
      seasonYear: 2024,
      seasonLabel: '2023-24',
      externalKey: '999|2024|NHL',
      aligned: true,
    })
  })
})

describe('resolveCatalogPassSeasonYear', () => {
  it('maps NFL split-season labels to Real start-year season_year values', () => {
    expect(resolveCatalogPassSeasonYear(2024, '2024-25', 'NFL')).toBe(2024)
    expect(resolveCatalogPassSeasonYear(2025, '2024-25', 'NFL')).toBe(2024)
  })
})

describe('CFB — start-year encoding', () => {
  it('treats season_year 2024 as 2024-25', () => {
    expect(resolveCatalogPassSeasonYear(2024, '2024-25', 'CFB')).toBe(2024)
    expect(expectedSeasonLabelFromYear(2024, 'CFB')).toBe('2024-25')
    expect(isCatalogSeasonMetadataAligned(2024, '2024-25', 'CFB')).toBe(true)
  })
})

describe('CBB — end-year encoding', () => {
  const cbbPass = {
    entityId: 42,
    sport: 'CBB',
    seasonYear: 2025,
    seasonLabel: '2024-25',
  }

  it('treats season_year 2025 as 2024-25 (not 2025-26)', () => {
    expect(resolveCatalogPassSeasonYear(2025, '2024-25', 'CBB')).toBe(2025)
    expect(expectedSeasonLabelFromYear(2025, 'CBB')).toBe('2024-25')
    expect(isCatalogSeasonMetadataAligned(2025, '2024-25', 'CBB')).toBe(true)
    expect(isCatalogSeasonMetadataAligned(2024, '2024-25', 'CBB')).toBe(false)
  })

  it('does not rewrite already-correct CBB pass metadata on upsert', () => {
    expect(canonicalCatalogPassMetadata(cbbPass)).toEqual({
      seasonYear: 2025,
      seasonLabel: '2024-25',
      externalKey: '42|2025|CBB',
      aligned: true,
    })
  })

  it('repairs old CBB start-year labels toward end-year without bumping season_year', () => {
    expect(
      canonicalCatalogPassMetadata({
        entityId: 42,
        sport: 'CBB',
        seasonYear: 2026,
        seasonLabel: '2026-27',
      }),
    ).toEqual({
      seasonYear: 2026,
      seasonLabel: '2025-26',
      externalKey: '42|2026|CBB',
      aligned: false,
    })
  })

  it('keeps in-season college game dates and only drops prior-season noise', () => {
    const rows = [
      { claimDay: '2024-11-15', baseRaxEarned: 10 },
      { claimDay: '2025-03-01', baseRaxEarned: 12 },
      { claimDay: '2023-11-26', baseRaxEarned: 99 },
    ]
    expect(filterDailyRowsToPassSeason(rows, 2025, 'CBB', '2024-25')).toEqual([
      { claimDay: '2024-11-15', baseRaxEarned: 10 },
      { claimDay: '2025-03-01', baseRaxEarned: 12 },
    ])
  })
})

describe('end-year pro sports with clean catalog metadata (NBA)', () => {
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
})

// Confirmed from a live Real pass: `season: 2025` with `seasonDisplay: "2025-26"`.
describe('FC — start-year encoding', () => {
  it('treats season_year 2025 as 2025-26 (not 2024-25)', () => {
    expect(expectedSeasonLabelFromYear(2025, 'FC')).toBe('2025-26')
    expect(expectedSeasonLabelFromYear(2025, 'soccer')).toBe('2025-26')
    expect(resolveCatalogPassSeasonYear(2025, '2025-26', 'FC')).toBe(2025)
    expect(isCatalogSeasonMetadataAligned(2025, '2025-26', 'FC')).toBe(true)
  })

  it('rejects the old end-year pairing', () => {
    expect(isCatalogSeasonMetadataAligned(2026, '2025-26', 'FC')).toBe(false)
    expect(isCatalogSeasonMetadataAligned(2024, '2023-24', 'FC')).toBe(false)
  })

  it('does not rewrite an already-correct FC pass on upsert', () => {
    expect(
      canonicalCatalogPassMetadata({
        entityId: 551,
        sport: 'FC',
        seasonYear: 2025,
        seasonLabel: '2025-26',
      }),
    ).toEqual({
      seasonYear: 2025,
      seasonLabel: '2025-26',
      externalKey: '551|2025|FC',
      aligned: true,
    })
  })

  it('keeps Real seasonDisplay unchanged through the catalog import label rules', () => {
    expect(importSeasonLabelForCatalog('FC', 2025, '2025-26')).toBe('2025-26')
  })

  it('still exempts FC from claim-day season filtering, so the window change is inert', () => {
    expect(claimDayInPassSeason('2020-01-01', 2025, 'FC', '2025-26')).toBe(true)
    expect(claimDayInPassSeason('2030-12-31', 2025, 'FC')).toBe(true)
    expect(passSeasonDateWindow(2025, 'FC')).toEqual({
      start: '2025-08-01',
      end: '2026-06-30',
    })
  })
})

// Confirmed from live Real: UFC passes use season 2023 + seasonDisplay "All-time".
describe('UFC — All-time sentinel season 2023', () => {
  it('keeps calendar label 2023 for catalog metadata', () => {
    expect(expectedSeasonLabelFromYear(2023, 'UFC')).toBe('2023')
    expect(seasonYearKindForSport('UFC')).toBe('calendar')
  })

  it('skips claim-day season filtering so All-time dailies are kept', () => {
    expect(claimDayInPassSeason('2020-01-01', 2023, 'UFC', '2023')).toBe(true)
    expect(claimDayInPassSeason('2026-07-11', 2023, 'ufc')).toBe(true)
  })
})

describe('catalogExternalKeyCandidates', () => {
  it('includes listing and canonical keys for start-year sports', () => {
    expect(
      catalogExternalKeyCandidates({
        entityId: 100,
        sport: 'NFL',
        seasonYear: 2024,
        seasonLabel: '2024-25',
      }),
    ).toEqual(['100|2024|NFL'])
  })

  it('includes resolved key when listing season_year differs from label', () => {
    expect(
      catalogExternalKeyCandidates({
        entityId: 200,
        sport: 'NFL',
        seasonYear: 2025,
        seasonLabel: '2024-25',
      }),
    ).toEqual(expect.arrayContaining(['200|2025|NFL', '200|2024|NFL']))
  })
})

describe('filterDailyRowsToPassSeason', () => {
  it('removes out-of-season rows before catalog upsert', () => {
    const rows = [
      { claimDay: '2024-09-08', baseRaxEarned: 12 },
      { claimDay: '2023-11-26', baseRaxEarned: 99 },
      { claimDay: '2025-01-19', baseRaxEarned: 18 },
    ]
    expect(filterDailyRowsToPassSeason(rows, 2024, 'NFL')).toEqual([
      { claimDay: '2024-09-08', baseRaxEarned: 12 },
      { claimDay: '2025-01-19', baseRaxEarned: 18 },
    ])
  })

  it('keeps all FC daily rows regardless of claim day', () => {
    const rows = [
      { claimDay: '2025-02-10', baseRaxEarned: 12 },
      { claimDay: '2024-12-31', baseRaxEarned: 99 },
      { claimDay: '2026-01-01', baseRaxEarned: 18 },
    ]
    expect(filterDailyRowsToPassSeason(rows, 2026, 'FC', '2025-26')).toEqual(rows)
  })

  it('skips claim-day season filtering for FC', () => {
    expect(claimDayInPassSeason('2020-01-01', 2026, 'FC', '2025-26')).toBe(true)
    expect(claimDayInPassSeason('2030-12-31', 2026, 'FC', '2025-26')).toBe(true)
  })
})

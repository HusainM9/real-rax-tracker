import { describe, expect, it } from 'vitest'
import { resolveUsernameImportSeasonLabel, usernameImportExternalKey } from './usernameImportShared'

describe('resolveUsernameImportSeasonLabel', () => {
  it('prefers OTD season labels for split-year sports', () => {
    expect(
      resolveUsernameImportSeasonLabel({
        sportRaw: 'nfl',
        seasonYear: 2024,
        otdSeasonLabel: '2024-25',
        passSeasonLabel: '2023-24',
      }),
    ).toBe('2024-25')
  })

  it('derives start-year labels for FC when no upstream label is given', () => {
    expect(
      resolveUsernameImportSeasonLabel({ sportRaw: 'fc', seasonYear: 2025 }),
    ).toBe('2025-26')
    expect(
      resolveUsernameImportSeasonLabel({
        sportRaw: 'soccer',
        seasonYear: 2025,
        passSeasonLabel: '2025-26',
      }),
    ).toBe('2025-26')
  })

  it('uses calendar year for golf', () => {
    expect(
      resolveUsernameImportSeasonLabel({
        sportRaw: 'golf',
        seasonYear: 2025,
        passSeasonLabel: '2024',
      }),
    ).toBe('2025')
  })
})

describe('usernameImportExternalKey', () => {
  it('matches client and server import keys', () => {
    expect(usernameImportExternalKey(20001984, 2026, 'nba')).toBe('20001984|2026|NBA')
    expect(usernameImportExternalKey(100, 2025, 'golf')).toBe('100|2025|Golf')
  })
})

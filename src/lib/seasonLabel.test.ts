import { describe, expect, it } from 'vitest'
import { isCollegeSport, seasonLabelFromPass } from './seasonLabel'

describe('seasonLabelFromPass', () => {
  it('uses start-year labels for CFB and end-year labels for CBB', () => {
    expect(seasonLabelFromPass(2025, 'ncaaf')).toBe('2025-26')
    expect(seasonLabelFromPass(2024, 'cfb')).toBe('2024-25')
    expect(seasonLabelFromPass(2026, 'ncaaf')).toBe('2026-27')
    expect(seasonLabelFromPass(2026, 'ncaam')).toBe('2025-26')
  })

  it('uses start-year labels for NFL and end-year labels for NHL', () => {
    expect(seasonLabelFromPass(2026, 'nfl')).toBe('2026-27')
    expect(seasonLabelFromPass(2026, 'nhl')).toBe('2025-26')
  })

  it('uses prior-year labels for NBA', () => {
    expect(seasonLabelFromPass(2026, 'nba')).toBe('2025-26')
  })

  // Real reports FC passes as season 2025 with seasonDisplay "2025-26".
  it('uses start-year labels for FC', () => {
    expect(seasonLabelFromPass(2025, 'fc')).toBe('2025-26')
    expect(seasonLabelFromPass(2025, 'soccer')).toBe('2025-26')
    expect(seasonLabelFromPass(2026, 'fc')).toBe('2026-27')
    expect(seasonLabelFromPass(2026, 'soccer')).toBe('2026-27')
  })

  it('uses calendar year for UFC passes', () => {
    expect(seasonLabelFromPass(2023, 'ufc')).toBe('2023')
  })

  it('uses calendar year for golf passes', () => {
    expect(seasonLabelFromPass(2025, 'golf')).toBe('2025')
    expect(seasonLabelFromPass(2026, 'golf')).toBe('2026')
  })

  it('uses calendar year for MLB and WNBA passes', () => {
    expect(seasonLabelFromPass(2026, 'mlb')).toBe('2026')
    expect(seasonLabelFromPass(2026, 'wnba')).toBe('2026')
  })
})

describe('isCollegeSport', () => {
  it('detects college sport aliases', () => {
    expect(isCollegeSport('ncaaf')).toBe(true)
    expect(isCollegeSport('cfb')).toBe(true)
    expect(isCollegeSport('ncaam')).toBe(true)
    expect(isCollegeSport('nba')).toBe(false)
  })
})

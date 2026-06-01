import { describe, expect, it } from 'vitest'
import { monthDayKeyFromClaimDay } from './claimDayKey'

describe('claimDayKey', () => {
  it('extracts month/day keys from full dates', () => {
    expect(monthDayKeyFromClaimDay('2026-01-15')).toBe('01-15')
  })

  it('accepts month/day keys as-is', () => {
    expect(monthDayKeyFromClaimDay('01-15')).toBe('01-15')
  })
})

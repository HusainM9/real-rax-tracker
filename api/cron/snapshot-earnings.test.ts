import { describe, expect, it } from 'vitest'
import { isEasternSnapshotTime } from './snapshot-earnings'

describe('scheduled earnings snapshot window', () => {
  it('never accepts a run before 6:30 AM Eastern', () => {
    expect(isEasternSnapshotTime(new Date('2026-01-15T11:29:00Z'))).toBe(false)
    expect(isEasternSnapshotTime(new Date('2026-07-15T10:29:00Z'))).toBe(false)
  })

  it('accepts on-time and delayed 6:30 AM Eastern runs across DST', () => {
    expect(isEasternSnapshotTime(new Date('2026-01-15T11:30:00Z'))).toBe(true)
    expect(isEasternSnapshotTime(new Date('2026-07-15T10:45:00Z'))).toBe(true)
  })

  it('rejects the inactive seasonal cron after the 6 AM hour', () => {
    expect(isEasternSnapshotTime(new Date('2026-01-15T10:30:00Z'))).toBe(false)
    expect(isEasternSnapshotTime(new Date('2026-07-15T11:30:00Z'))).toBe(false)
  })
})

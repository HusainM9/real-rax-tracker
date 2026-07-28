import { describe, expect, it } from 'vitest'
import type { PackTracker } from '../types/rax'
import {
  DEFAULT_PACK_RATING_INCREMENT,
  estimatePackProgress,
  formatProjectedFinishDate,
  ICONIC_RATING_TARGET,
  projectedFinishDate,
} from './packTracker'

function tracker(partial: Partial<PackTracker> = {}): PackTracker {
  return {
    id: 'pack_1',
    plannedPassId: 'plan_1',
    accounts: [
      { id: 'acc_1', name: 'Main', rating: 1000, opensPacks: true },
      { id: 'acc_2', name: 'Alt', rating: 500, opensPacks: true },
    ],
    ratingPerPack: DEFAULT_PACK_RATING_INCREMENT,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...partial,
  }
}

describe('estimatePackProgress', () => {
  it('sums ratings and estimates packs/days with multiple opening accounts', () => {
    const estimate = estimatePackProgress(tracker())
    expect(estimate.totalRating).toBe(1500)
    expect(estimate.remaining).toBe(ICONIC_RATING_TARGET - 1500)
    expect(estimate.packsNeeded).toBe(Math.ceil((ICONIC_RATING_TARGET - 1500) / 10))
    expect(estimate.openingAccounts).toBe(2)
    expect(estimate.dailyGain).toBe(20)
    expect(estimate.daysRemaining).toBe(Math.ceil((ICONIC_RATING_TARGET - 1500) / 20))
    expect(estimate.atTarget).toBe(false)
  })

  it('returns null days when nothing opens packs', () => {
    const estimate = estimatePackProgress(
      tracker({
        accounts: [{ id: 'acc_1', name: 'Main', rating: 100, opensPacks: false }],
      }),
    )
    expect(estimate.daysRemaining).toBeNull()
    expect(estimate.packsNeeded).toBe(Math.ceil((ICONIC_RATING_TARGET - 100) / 10))
  })

  it('marks complete at or above target', () => {
    const estimate = estimatePackProgress(
      tracker({
        accounts: [{ id: 'acc_1', name: 'Main', rating: ICONIC_RATING_TARGET, opensPacks: true }],
      }),
    )
    expect(estimate.atTarget).toBe(true)
    expect(estimate.packsNeeded).toBe(0)
    expect(estimate.daysRemaining).toBe(0)
  })
})

describe('projectedFinishDate', () => {
  it('adds days onto the from date', () => {
    const from = new Date(2026, 6, 28) // Jul 28 local
    expect(projectedFinishDate(0, from)?.toDateString()).toBe(from.toDateString())
    expect(projectedFinishDate(3, from)?.toDateString()).toBe(new Date(2026, 6, 31).toDateString())
    expect(projectedFinishDate(null, from)).toBeNull()
  })

  it('formats readable finish labels', () => {
    const from = new Date(2026, 6, 28)
    expect(formatProjectedFinishDate(0, from)).toBe('Done')
    expect(formatProjectedFinishDate(null, from)).toBe('—')
    expect(formatProjectedFinishDate(2, from)).toMatch(/Jul/)
  })
})

import { describe, expect, it } from 'vitest'
import {
  liveDailyPassBatches,
  normalizeGordonDailyUsernames,
} from './gordonDailyEarnings'

describe('normalizeGordonDailyUsernames', () => {
  it('always includes the signed-in account first and dedupes others', () => {
    expect(normalizeGordonDailyUsernames(['@Alice', 'gordon', 'alice', 'bob'], '@Gordon')).toEqual([
      'gordon',
      'alice',
      'bob',
    ])
  })
})

describe('liveDailyPassBatches', () => {
  it('groups passes by sport and keeps every serverless request small', () => {
    const passes = [
      ...Array.from({ length: 14 }, (_, entityId) => ({ entityId, sportRaw: 'fc' })),
      ...Array.from({ length: 3 }, (_, entityId) => ({ entityId: entityId + 20, sportRaw: 'mlb' })),
    ]

    const batches = liveDailyPassBatches(passes, 6)

    expect(batches.map((batch) => batch.length)).toEqual([6, 6, 2, 3])
    expect(batches.every((batch) => new Set(batch.map((pass) => pass.sportRaw)).size === 1)).toBe(true)
    expect(batches.flat()).toHaveLength(passes.length)
  })
})

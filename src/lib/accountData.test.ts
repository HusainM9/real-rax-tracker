import { describe, expect, it } from 'vitest'
import { decodeAccountDataPayload } from './accountData'
import { createEmptyData, importTrackerData } from './storage'

describe('account profile decoding', () => {
  it('normalizes the decoded object identically without serializing/parsing it again', async () => {
    const data = { ...createEmptyData(), cards: [{ id: 'one', name: 'Player', sport: 'NBA', season: '2026-27', notes: '', createdAt: '2026-10-30T00:00:00Z' }] }
    const decoded = await decodeAccountDataPayload({ data, cardCount: 1 })
    expect(decoded.data).toEqual(importTrackerData(JSON.stringify(data)))
    expect(decoded.meta.cardCount).toBe(1)
  })
  it('still rejects profiles reporting missing cards or earnings', async () => {
    await expect(decodeAccountDataPayload({ data: {}, cardCount: 1 })).rejects.toThrow('server reported cards')
    await expect(decodeAccountDataPayload({ data: {}, performanceCount: 1 })).rejects.toThrow('server reported earnings')
  })
})

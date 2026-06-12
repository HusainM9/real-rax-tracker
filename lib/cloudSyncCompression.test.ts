// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  decodeStoredProfilePayload,
  encodeStoredProfilePayload,
  encodedProfileByteLength,
  gunzipBase64ToJson,
  gzipJsonToBase64,
} from './cloudSyncCompression'

describe('cloudSyncCompression', () => {
  it('round-trips tracker-shaped JSON', async () => {
    const payload = {
      cards: [{ id: '1', name: 'Test', sport: 'NBA', season: '2024', notes: '', createdAt: '2024-01-01' }],
      performances: [
        { id: 'p1', cardId: '1', claimDay: '2024-01-01', raxEarned: 10, note: '', createdAt: '2024-01-01' },
      ],
    }

    const encoded = await gzipJsonToBase64(payload)
    expect(encoded.length).toBeGreaterThan(0)
    expect(await gunzipBase64ToJson(encoded)).toEqual(payload)
  })

  it('stores gzip payloads smaller than raw JSON for repetitive data', async () => {
    const payload = {
      cards: [],
      performances: Array.from({ length: 500 }, (_, index) => ({
        id: `perf-${index}`,
        cardId: `card-${index % 20}`,
        claimDay: `2024-${String((index % 12) + 1).padStart(2, '0')}-01`,
        raxEarned: index,
        note: '',
        createdAt: '2024-01-01T00:00:00.000Z',
      })),
    }

    const encoded = await encodeStoredProfilePayload(payload)
    expect(encodedProfileByteLength(encoded.dataBlob)).toBeLessThan(JSON.stringify(payload).length / 3)
  })

  it('reads legacy uncompressed payloads', async () => {
    const payload = { cards: [], performances: [] }
    await expect(decodeStoredProfilePayload({ data: payload })).resolves.toEqual(payload)
  })

  it('reads gzip payloads', async () => {
    const payload = { cards: [], performances: [{ id: '1', cardId: '1', claimDay: '2024-01-01', raxEarned: 1, note: '', createdAt: '2024-01-01' }] }
    const encoded = await encodeStoredProfilePayload(payload)
    await expect(decodeStoredProfilePayload(encoded)).resolves.toEqual(payload)
  })
})

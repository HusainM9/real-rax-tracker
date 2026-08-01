// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { gunzipBytesToJson } from './cloudSyncCompression'
import { buildGzipSyncPutBody } from './cloudSyncRequest'

describe('buildGzipSyncPutBody', () => {
  it('gzips compacted tracker data for sync PUTs', async () => {
    const put = await buildGzipSyncPutBody({
      data: {
        cards: [],
        performances: [],
        cachedPlayerEarnings: [{ cacheKey: 'x', rows: [] }],
      },
      ifUnmodifiedSince: '2024-01-01T00:00:00.000Z',
    })

    expect(put.headers['X-Rax-Content-Encoding']).toBe('gzip')
    expect(put.headers['Content-Type']).toBe('application/json')

    const decoded = (await gunzipBytesToJson(put.body)) as {
      data: { cachedPlayerEarnings?: unknown }
      ifUnmodifiedSince?: string
    }
    expect(decoded.ifUnmodifiedSince).toBe('2024-01-01T00:00:00.000Z')
    expect(decoded.data.cachedPlayerEarnings).toBeUndefined()
    expect(put.body.byteLength).toBeLessThan(
      new TextEncoder().encode(
        JSON.stringify({
          data: {
            cards: [],
            performances: [],
            cachedPlayerEarnings: [{ cacheKey: 'x', rows: [] }],
          },
          ifUnmodifiedSince: '2024-01-01T00:00:00.000Z',
        }),
      ).length,
    )
  })
})

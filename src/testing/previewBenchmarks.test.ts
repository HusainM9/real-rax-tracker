import { afterEach, expect, it, vi } from 'vitest'
import { probePackRatings } from './previewBenchmarks'

afterEach(() => vi.unstubAllGlobals())
it('measures five fresh and five reused reads without any account/profile write', async () => {
  const bodies: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('/api/import/pack-ratings')
    const body = JSON.parse(String(init.body))
    bodies.push(body)
    return Response.json({ username: 'gordon', passes: [], passCount: 0, source: body.forceRefresh ? 'real' : 'cache', fetchedAt: '2026-10-30T17:00:00Z' })
  }))
  const result = await probePackRatings('gordon')
  expect(result).toHaveLength(10)
  expect(result.every((row) => row.passCount === 0 && row.hash === result[0]?.hash)).toBe(true)
  expect(bodies.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => ({ username: 'gordon', forceRefresh: true })))
  expect(bodies.slice(5)).toEqual(Array.from({ length: 5 }, () => ({ username: 'gordon' })))
})

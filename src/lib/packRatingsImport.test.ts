import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => { vi.resetModules() })
afterEach(() => vi.unstubAllGlobals())
const response = () => Response.json({
  username: 'gordon', passCount: 1,
  passes: [{ externalKey: '1|2026|NBA', entityId: 1, name: 'Player', sport: 'NBA', season: '2026-27', seasonYear: 2026, passKind: 'player', progress: 5, rating: 200 }],
  fetchedAt: '2026-10-30T17:00:00Z', source: 'cache',
  startedAt: '2026-10-30T16:59:59Z', avatarUrl: 'https://media.realapp.com/example.webp',
})

describe('pack rating imports', () => {
  it('shares one request between normalized callers without letting one cancellation abort the other', async () => {
    let release!: (response: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { release = resolve }))
    vi.stubGlobal('fetch', fetcher)
    const { fetchPackRatings } = await import('./packRatingsImport')
    const controller = new AbortController()
    const first = fetchPackRatings(' @Gordon ', controller.signal)
    const second = fetchPackRatings('gordon')
    expect(fetcher).toHaveBeenCalledTimes(1)
    controller.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    release(response())
    expect(await second).toMatchObject({ passCount: 1, source: 'cache', fetchedAt: '2026-10-30T17:00:00Z', startedAt: '2026-10-30T16:59:59Z', avatarUrl: 'https://media.realapp.com/example.webp' })
  })

  it('sends explicit force refresh and keeps legacy success responses compatible', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ username: 'gordon', passes: [], passCount: 0 }))
    vi.stubGlobal('fetch', fetcher)
    const { fetchPackRatings } = await import('./packRatingsImport')
    expect(await fetchPackRatings('gordon', undefined, { forceRefresh: true })).toMatchObject({ passes: [], passCount: 0 })
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ username: 'gordon', forceRefresh: true })
  })

  it('retries after a failed response instead of retaining a rejected shared promise', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'Rate limited' }, { status: 429 })).mockImplementation(async () => response())
    vi.stubGlobal('fetch', fetcher)
    const { fetchPackRatings } = await import('./packRatingsImport')
    await expect(fetchPackRatings('gordon')).rejects.toThrow('Rate limited')
    expect((await fetchPackRatings('gordon')).passes).toHaveLength(1)
  })

  it('does not turn a malformed success response into missing ownership', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ username: 'gordon', passCount: 5 })))
    const { fetchPackRatings } = await import('./packRatingsImport')
    await expect(fetchPackRatings('gordon')).rejects.toThrow(/invalid|missing/i)
  })
})

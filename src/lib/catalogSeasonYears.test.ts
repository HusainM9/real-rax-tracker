import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => vi.resetModules())
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
const result = () => Response.json({ seasonYears: [{ seasonYear: 2026, seasonLabel: '2026-27' }], storageConfigured: true })

describe('season picker request reuse', () => {
  it('shares a request and cached results between consumers without sharing mutable arrays', async () => {
    const fetcher = vi.fn(async () => result())
    vi.stubGlobal('fetch', fetcher)
    const { fetchCatalogSeasonYears } = await import('./catalogApi')
    const [first, second] = await Promise.all([
      fetchCatalogSeasonYears({ sport: 'CFB' }), fetchCatalogSeasonYears({ sport: 'CFB' }),
    ])
    expect(fetcher).toHaveBeenCalledTimes(1)
    first.seasonYears[0].seasonLabel = 'Changed by caller'
    second.seasonYears.length = 0
    expect(await fetchCatalogSeasonYears({ sport: 'CFB' })).toEqual({
      seasonYears: [{ seasonYear: 2026, seasonLabel: '2026-27' }], storageConfigured: true,
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('refreshes expired metadata and isolates sports and pass kinds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const fetcher = vi.fn(async () => result())
    vi.stubGlobal('fetch', fetcher)
    const { fetchCatalogSeasonYears } = await import('./catalogApi')
    await fetchCatalogSeasonYears({ sport: 'CFB' })
    await fetchCatalogSeasonYears({ sport: 'NFL' })
    await fetchCatalogSeasonYears({ sport: 'CFB', passKind: 'team' })
    vi.setSystemTime(Date.now() + 299_999)
    await fetchCatalogSeasonYears({ sport: 'CFB' })
    expect(fetcher).toHaveBeenCalledTimes(3)
    vi.setSystemTime(Date.now() + 1)
    await fetchCatalogSeasonYears({ sport: 'CFB' })
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('cancels one caller without cancelling another dropdown waiting for the same seasons', async () => {
    let finish!: (response: Response) => void
    const fetcher = vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      finish = resolve
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)
    const { fetchCatalogSeasonYears } = await import('./catalogApi')
    const controller = new AbortController()
    const first = fetchCatalogSeasonYears({ sport: 'CFB' }, controller.signal)
    const second = fetchCatalogSeasonYears({ sport: 'CFB' })
    controller.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    finish(result())
    expect((await second).seasonYears).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not retain a failed request or unconfigured storage as a cached empty list', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'Catalog unavailable' }, { status: 503, headers: { 'x-tracker-error-recorded': '1' } }))
      .mockResolvedValueOnce(Response.json({ seasonYears: [], storageConfigured: false }))
      .mockImplementation(async () => result())
    vi.stubGlobal('fetch', fetcher)
    const { fetchCatalogSeasonYears } = await import('./catalogApi')
    await expect(fetchCatalogSeasonYears({ sport: 'CFB' })).rejects.toThrow('Catalog unavailable')
    expect((await fetchCatalogSeasonYears({ sport: 'CFB' })).storageConfigured).toBe(false)
    expect((await fetchCatalogSeasonYears({ sport: 'CFB' })).seasonYears).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('combines UFC player and team years while sharing a team-only consumer', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const params = new URL(input, 'https://tracker.example.test').searchParams
      return Response.json({ seasonYears: params.get('passKind') === 'team'
        ? [{ seasonYear: 2023, seasonLabel: '2023' }] : [{ seasonYear: 2024, seasonLabel: '2024' }], storageConfigured: true })
    })
    vi.stubGlobal('fetch', fetcher)
    const { fetchCatalogSeasonYears } = await import('./catalogApi')
    const [combined, teams] = await Promise.all([
      fetchCatalogSeasonYears({ sport: 'UFC' }), fetchCatalogSeasonYears({ sport: 'UFC', passKind: 'team' }),
    ])
    expect(combined.seasonYears.map(option => option.seasonYear)).toEqual([2024, 2023])
    expect(teams.seasonYears.map(option => option.seasonYear)).toEqual([2023])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not cache malformed metadata or send requests for already-cancelled consumers', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ storageConfigured: true })).mockImplementation(async () => result())
    vi.stubGlobal('fetch', fetcher)
    const { fetchCatalogSeasonYears } = await import('./catalogApi')
    await expect(fetchCatalogSeasonYears({ sport: 'CFB' })).rejects.toThrow(/invalid season/i)
    expect((await fetchCatalogSeasonYears({ sport: 'CFB' })).seasonYears).toHaveLength(1)
    const abort = new AbortController(); abort.abort()
    await expect(fetchCatalogSeasonYears({ sport: 'CFB' }, abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

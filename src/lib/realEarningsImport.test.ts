import { afterEach, describe, expect, it, vi } from 'vitest'
import { REAL_EARNINGS_PASSES_MAX_REQUEST } from '../../lib/realEarningsShared'
import { fetchDailyRaxRows, REAL_EARNINGS_ENDPOINT } from './realEarningsImport'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('fetchDailyRaxRows', () => {
  it('retains partial rows and the actual Real 500 without falsely assigning it to unrequested batches', async () => {
    const passes = [1, 2, 3].map((entityId) => ({ externalKey: `${entityId}|2025|FC`, entityId, passKind: 'player' as const, sportRaw: 'fc', seasonYear: 2025, seasonLabel: '2025-26', name: `Player ${entityId}` }))
    const fetcher = vi.fn().mockResolvedValue(Response.json({ passes: [{ externalKey: passes[0]!.externalKey, source: 'cache', rows: [{ claimDay: '2025-02-01', baseRaxEarned: 12 }] }], failures: [{ externalKey: passes[1]!.externalKey, name: 'Player 2', kind: 'upstream', upstreamStatus: 500, retryable: false, message: 'Stopped' }] }))
    vi.stubGlobal('fetch', fetcher)
    const result = await fetchDailyRaxRows(passes, { batchSize: 2, concurrency: 1 })
    expect(result.rowsByExternalKey.get(passes[0]!.externalKey)?.[0]?.baseRaxEarned).toBe(12)
    expect(result.failures).toHaveLength(2)
    expect(result.failures[0]).toMatchObject({ externalKey: passes[1]!.externalKey, retryable: false, upstreamStatus: 500 })
    expect(result.failures[1]).toMatchObject({ externalKey: passes[2]!.externalKey, kind: 'deferred', retryable: true })
    expect(result.failures[1]?.upstreamStatus).toBeUndefined()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('stops queued cache probes on an authorization failure without falling back to Real', async () => {
    const passes = Array.from({ length: 200 }, (_, index) => ({
      externalKey: `${index + 1}|2025|FC`,
      entityId: index + 1,
      passKind: 'player' as const,
      sportRaw: 'fc',
      seasonYear: 2025,
      seasonLabel: '2025-26',
      name: `Player ${index + 1}`,
    }))
    let releaseSibling!: (response: Response) => void
    const sibling = new Promise<Response>((resolve) => { releaseSibling = resolve })
    let finishSibling!: () => void
    const siblingFinished = new Promise<void>((resolve) => { finishSibling = resolve })
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'Account login required' }, { status: 401 }))
      .mockReturnValueOnce(sibling) as typeof fetch

    const pending = fetchDailyRaxRows(passes, { cacheFirst: true, onProgress: finishSibling })
    await expect(pending).rejects.toThrow('Account login required')
    releaseSibling(Response.json({ passes: [] }))
    await siblingFinished
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('probes a large warm collection in one cache-only request instead of many upstream batches', async () => {
    const passes = Array.from({ length: 60 }, (_, index) => ({ externalKey: `${index}|2025|FC`, entityId: index + 1, passKind: 'player' as const, sportRaw: 'fc', seasonYear: 2025, seasonLabel: '2025-26', name: `Player ${index}` }))
    globalThis.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body))
      expect(body.cacheOnly).toBe(true)
      return Response.json({ passes: body.passes.map((pass: { externalKey: string }) => ({ externalKey: pass.externalKey, source: 'cache', rows: [] })) })
    }) as typeof fetch
    const result = await fetchDailyRaxRows(passes, { cacheFirst: true })
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(result.stats).toMatchObject({ requested: 60, cacheHits: 60, upstreamRequests: 0 })
  })

  it('refreshes only cache misses and gracefully falls back when the probe is unavailable', async () => {
    const passes = Array.from({ length: 18 }, (_, index) => ({ externalKey: `${index}|2025|FC`, entityId: index + 1, passKind: 'player' as const, sportRaw: 'fc', seasonYear: 2025, seasonLabel: '2025-26', name: `Player ${index}` }))
    const batches: number[] = []
    globalThis.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body))
      const items = body.cacheOnly ? body.passes.slice(0, 16) : body.passes
      if (!body.cacheOnly) batches.push(items.length)
      return Response.json({ passes: items.map((pass: { externalKey: string }) => ({ externalKey: pass.externalKey, source: 'cache', rows: [] })), stats: { cacheHits: items.length, fetched: 0, upstreamRequests: 0, cacheConfigured: true } })
    }) as typeof fetch
    const result = await fetchDailyRaxRows(passes, { cacheFirst: true })
    expect(batches).toEqual([2])
    expect(result.stats.cacheHits).toBe(18)

    globalThis.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body))
      if (body.cacheOnly) return Response.json({ error: 'Older server' }, { status: 400 })
      return Response.json({ passes: body.passes.map((pass: { externalKey: string }) => ({ externalKey: pass.externalKey, source: 'cache', rows: [] })) })
    }) as typeof fetch
    expect((await fetchDailyRaxRows(passes, { cacheFirst: true })).rowsByExternalKey.size).toBe(18)
    expect(globalThis.fetch).toHaveBeenCalledTimes(3)
  })
  it('starts the next batch as soon as a concurrency slot becomes free', async () => {
    const passes = Array.from({ length: 3 }, (_, index) => ({
      externalKey: `${index}|2025|FC`, entityId: index + 1, passKind: 'player' as const,
      sportRaw: 'fc', seasonYear: 2025, seasonLabel: '2025-26', name: `Player ${index}`,
    }))
    const releases: Array<(response: Response) => void> = []
    globalThis.fetch = vi.fn(() => new Promise<Response>((resolve) => releases.push(resolve))) as typeof fetch
    const progress: number[] = []
    const pending = fetchDailyRaxRows(passes, {
      batchSize: 1, concurrency: 2, onProgress: ({ completed }) => progress.push(completed),
    })
    expect(releases).toHaveLength(2)
    const response = (key: string) => Response.json({
      ok: true,
      passes: [{ externalKey: key, source: 'cache', rows: [] }],
    })
    releases[1]!(response(passes[1]!.externalKey))
    await vi.waitFor(() => expect(releases).toHaveLength(3))
    expect(progress).toEqual([1])
    releases[2]!(response(passes[2]!.externalKey))
    releases[0]!(response(passes[0]!.externalKey))
    const result = await pending
    expect(progress).toEqual([1, 2, 3])
    expect([...result.rowsByExternalKey.keys()]).toEqual(passes.map((pass) => pass.externalKey))
  })

  it('chunks passes at the route max and reports progress between batches', async () => {
    const passes = Array.from({ length: REAL_EARNINGS_PASSES_MAX_REQUEST + 2 }, (_, index) => ({
      externalKey: `${index}|2025|FC`,
      entityId: index + 1,
      passKind: 'player' as const,
      sportRaw: 'fc',
      seasonYear: 2025,
      seasonLabel: '2025-26',
      name: `Player ${index + 1}`,
    }))

    const progress: Array<{ completed: number; total: number }> = []
    const batchSizes: number[] = []

    globalThis.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { passes: Array<{ externalKey: string }> }
      batchSizes.push(body.passes.length)
      return Response.json({
        ok: true,
        stats: {
          requested: body.passes.length,
          cacheHits: body.passes.length,
          fetched: 0,
          upstreamRequests: 0,
          passesWithoutEarnings: 0,
          rowsWritten: 0,
          passesWritten: 0,
          cacheConfigured: true,
        },
        failures: [],
        passes: body.passes.map((pass) => ({
          externalKey: pass.externalKey,
          source: 'cache',
          rows: [{ claimDay: '2025-01-10', baseRaxEarned: 1, playerBoxScoreId: null }],
          cachedRowCount: 1,
          newRowCount: 0,
        })),
      })
    }) as unknown as typeof fetch

    const result = await fetchDailyRaxRows(passes, {
      concurrency: 1,
      onProgress: (value) => progress.push(value),
    })

    expect(batchSizes[0]).toBe(REAL_EARNINGS_PASSES_MAX_REQUEST)
    expect(batchSizes[1]).toBe(2)
    expect(progress.at(-1)).toEqual({ completed: passes.length, total: passes.length })
    expect(result.stats.requested).toBe(passes.length)
    expect(result.stats.cacheHits).toBe(passes.length)
    expect(result.rowsByExternalKey.size).toBe(passes.length)
    expect(String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toBe(
      REAL_EARNINGS_ENDPOINT,
    )
  })

  it('stops later batches after a Real 500 but leaves unrequested work available for a later manual attempt', async () => {
    const passes = [
      {
        externalKey: '1|2025|FC',
        entityId: 1,
        passKind: 'player' as const,
        sportRaw: 'fc',
        seasonYear: 2025,
        seasonLabel: '2025-26',
        name: 'One',
      },
      {
        externalKey: '2|2025|FC',
        entityId: 2,
        passKind: 'player' as const,
        sportRaw: 'fc',
        seasonYear: 2025,
        seasonLabel: '2025-26',
        name: 'Two',
      },
    ]

    let calls = 0
    globalThis.fetch = vi.fn(async (_input, init) => {
      calls += 1
      const body = JSON.parse(String(init?.body ?? '{}')) as { passes: Array<{ externalKey: string }> }
      if (calls === 1) {
        return Response.json({ error: 'Real endpoint paused', provider: 'real', upstreamStatus: 500, retryable: false }, { status: 423 })
      }
      return Response.json({
        ok: true,
        stats: {
          requested: 1,
          cacheHits: 0,
          fetched: 1,
          upstreamRequests: 1,
          passesWithoutEarnings: 0,
          rowsWritten: 1,
          passesWritten: 1,
          cacheConfigured: true,
        },
        failures: [],
        passes: [
          {
            externalKey: body.passes[0]!.externalKey,
            source: 'real',
            rows: [{ claimDay: '2025-01-10', baseRaxEarned: 3, playerBoxScoreId: null }],
            cachedRowCount: 0,
            newRowCount: 1,
          },
        ],
      })
    }) as unknown as typeof fetch

    const result = await fetchDailyRaxRows(passes, { batchSize: 1, concurrency: 1 })

    expect(result.failures).toHaveLength(2)
    expect(result.failures[0]).toMatchObject({ externalKey: '1|2025|FC', upstreamStatus: 500, retryable: false })
    expect(result.failures[1]).toMatchObject({ externalKey: '2|2025|FC', kind: 'deferred', retryable: true })
    expect(result.failures[1]?.upstreamStatus).toBeUndefined()
    expect(result.rowsByExternalKey.size).toBe(0)
    expect(calls).toBe(1)
  })

  it('retries a batch-level 429 then keeps partial later successes', async () => {
    vi.useFakeTimers()
    const passes = [
      {
        externalKey: '1|2025|FC',
        entityId: 1,
        passKind: 'player' as const,
        sportRaw: 'fc',
        seasonYear: 2025,
        seasonLabel: '2025-26',
        name: 'One',
      },
    ]

    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls += 1
      if (calls < 3) {
        return Response.json(
          { error: 'Real API rate limited this request (429).', code: 'real_rate_limited' },
          { status: 429 },
        )
      }
      return Response.json({
        ok: true,
        stats: {
          requested: 1,
          cacheHits: 0,
          fetched: 1,
          upstreamRequests: 1,
          passesWithoutEarnings: 0,
          rowsWritten: 1,
          passesWritten: 1,
          cacheConfigured: true,
        },
        failures: [],
        passes: [
          {
            externalKey: '1|2025|FC',
            source: 'real',
            rows: [{ claimDay: '2025-01-10', baseRaxEarned: 4, playerBoxScoreId: null }],
            cachedRowCount: 0,
            newRowCount: 1,
          },
        ],
      })
    }) as unknown as typeof fetch

    const pending = fetchDailyRaxRows(passes, { batchSize: 1, concurrency: 1 })
    await vi.runAllTimersAsync()
    const result = await pending

    expect(calls).toBe(3)
    expect(result.failures).toEqual([])
    expect(result.rowsByExternalKey.get('1|2025|FC')).toEqual([
      { claimDay: '2025-01-10', baseRaxEarned: 4, playerBoxScoreId: null },
    ])
    vi.useRealTimers()
  })
})

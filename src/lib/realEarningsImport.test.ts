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

  it('degrades a failed batch into per-pass failures so later batches can continue', async () => {
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
        return Response.json({ error: 'temporary upstream failure' }, { status: 502 })
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

    expect(result.failures).toEqual([
      expect.objectContaining({
        externalKey: '1|2025|FC',
        kind: 'batch',
      }),
    ])
    expect(result.rowsByExternalKey.get('2|2025|FC')).toEqual([
      { claimDay: '2025-01-10', baseRaxEarned: 3, playerBoxScoreId: null },
    ])
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

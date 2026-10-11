import { afterEach, describe, expect, it, vi } from 'vitest'
import { cacheDailyEarningsResult, DailyEarningsRequestError, fetchAccountDailyEarnings, readCachedDailyEarningsResults, type DailyEarningsResult } from './dailyEarnings'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('fetchAccountDailyEarnings', () => {
  it('sends the refresh namespace used to isolate live scan caching', async () => {
    globalThis.fetch = vi.fn(async () => Response.json({
      username: 'gordon',
      day: '2026-10-12',
      dayDisplay: 'October 12, 2026',
      emptyMessage: '',
      earnings: [],
      dailyTotal: 0,
    })) as unknown as typeof fetch

    await fetchAccountDailyEarnings('gordon', '2026-10-12', { refreshId: 'refresh123' })

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/account/earnings', expect.objectContaining({
      body: JSON.stringify({ username: 'gordon', day: '2026-10-12', before: 0, refreshId: 'refresh123' }),
    }))
  })

  it('preserves rate-limit details for the account refresh log', async () => {
    globalThis.fetch = vi.fn(async () => Response.json(
      { error: 'Real API rate limited this request (429).', code: 'real_rate_limited' },
      { status: 429 },
    )) as unknown as typeof fetch

    const settled = fetchAccountDailyEarnings('gordon', '2026-10-12').catch((error) => error)
    await expect(settled).resolves.toMatchObject({
      name: 'DailyEarningsRequestError',
      status: 429,
      code: 'real_rate_limited',
    })
    await expect(settled).resolves.toBeInstanceOf(DailyEarningsRequestError)
  })
})

describe('daily earnings result cache', () => {
  const result = (username: string, dailyTotal: number, day = '2026-10-12'): DailyEarningsResult => ({
    username,
    day,
    dayDisplay: 'October 12, 2026',
    emptyMessage: '',
    earnings: [],
    dailyTotal,
  })

  it('keeps every account from a refresh-all scan available when changing report scope', () => {
    const gordon = result('gordon', 120)
    const alt = result('alt-account', 80)
    const cache = cacheDailyEarningsResult(cacheDailyEarningsResult({}, gordon), alt)

    expect(readCachedDailyEarningsResults(cache, ['gordon', 'alt-account'], '2026-10-12')).toEqual([gordon, alt])
    expect(readCachedDailyEarningsResults(cache, ['@GORDON'], '2026-10-12')).toEqual([gordon])
  })

  it('does not show a cached result on a different earnings day', () => {
    const cache = cacheDailyEarningsResult({}, result('gordon', 120))

    expect(readCachedDailyEarningsResults(cache, ['gordon'], '2026-10-13')).toEqual([])
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { DailyEarningsRequestError, fetchAccountDailyEarnings } from './dailyEarnings'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('fetchAccountDailyEarnings', () => {
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

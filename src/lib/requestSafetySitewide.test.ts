import { expect, it, vi } from 'vitest'
import { fetchAccountDailyEarnings } from './dailyEarnings'
import { loadAccountData } from './accountData'

it('blocks a later earnings refresh after an HTTP 500 outside collection imports', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: 'Upstream failure' }, { status: 500 }))
  vi.stubGlobal('fetch', fetcher)
  for (const refreshId of ['first', 'second']) {
    await expect(fetchAccountDailyEarnings('gordon', '2026-10-30', { refreshId })).rejects.toMatchObject({ upstreamStatus: 500, retryable: false })
  }
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('blocks a later saved-account read after an HTTP 503', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: 'Storage failure' }, { status: 503 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(loadAccountData()).rejects.toMatchObject({ upstreamStatus: 503, retryable: false })
  await expect(loadAccountData()).rejects.toMatchObject({ upstreamStatus: 503, retryable: false })
  expect(fetcher).toHaveBeenCalledTimes(1)
})

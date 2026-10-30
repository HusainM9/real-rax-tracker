import { expect, it, vi } from 'vitest'
import { loadAccountData } from './accountData'

it('reports an account read failure without permanently banning later normal page access', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'Storage temporarily unavailable' }, { status: 503 })).mockResolvedValue(Response.json({ data: { cards: [], performances: [] }, storageConfigured: true }))
  vi.stubGlobal('fetch', fetcher)
  await expect(loadAccountData()).rejects.toThrow(/storage/i)
  await expect(loadAccountData()).resolves.toBeDefined()
  expect(fetcher).toHaveBeenCalledTimes(2)
})

import { expect, it, vi } from 'vitest'
import scan from './marketplace-scan'
import cron from '../cron/marketplace-alerts'
import listings from './marketplace-player-listings'

it('restores marketplace auth checks before any provider network access', async () => {
  const fetcher = vi.fn(() => { throw new Error('Must not access any upstream') })
  vi.stubGlobal('fetch', fetcher)
  for (const handler of [scan, cron]) {
    const response = await handler(new Request('https://offline.invalid/api/scan', { method: 'POST' }))
    expect(response.status).toBe(401)
  }
  expect(fetcher).not.toHaveBeenCalled()
})

it('retires individual player listings before provider or auth-storage access', async () => {
  const fetcher = vi.fn(() => { throw new Error('Must not access any upstream') })
  vi.stubGlobal('fetch', fetcher)
  expect((await listings(new Request('https://offline.invalid/api/listings?sport=nba&entityId=42&season=2027'))).status).toBe(410)
  expect(fetcher).not.toHaveBeenCalled()
})

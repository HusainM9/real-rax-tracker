import { expect, it, vi } from 'vitest'
import tracking from '../../../api/account/earnings-tracking'
import { handleAccountEarnings } from '../../../lib/accountEarningsHandler'
import snapshot from '../../../api/cron/snapshot-earnings'
import summer from '../../../api/cron/snapshot-earnings-summer'
import winter from '../../../api/cron/snapshot-earnings-winter'
import fallback from '../../../api/cron/snapshot-earnings-fallback'
import finalCheck from '../../../api/cron/snapshot-earnings-final-check'
import golfSummer from '../../../api/cron/snapshot-earnings-golf-final-summer'
import golfWinter from '../../../api/cron/snapshot-earnings-golf-final-winter'
import afterSummer from '../../../api/cron/snapshot-earnings-after-six-summer'
import afterWinter from '../../../api/cron/snapshot-earnings-after-six-winter'

it('retires manual earnings/tracking without provider or storage requests', async () => {
  const fetcher = vi.fn(() => { throw new Error('Retired feature must not call upstream') })
  vi.stubGlobal('fetch', fetcher)
  for (const handler of [tracking, handleAccountEarnings]) {
    const response = await handler(new Request('https://offline.invalid/api/account/earnings', { method: 'POST' }))
    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({ retired: true, retryable: false })
  }
  expect(fetcher).not.toHaveBeenCalled()
})

it('acknowledges stale snapshot delivery through the deployed Node handler without network work', async () => {
  const fetcher = vi.fn(() => { throw new Error('Retired feature must not call upstream') })
  vi.stubGlobal('fetch', fetcher)
  let payload = ''
  const response = {
    statusCode: 0,
    setHeader: vi.fn(),
    end: (body?: string | Uint8Array) => { payload = typeof body === 'string' ? body : new TextDecoder().decode(body) },
  }
  await snapshot({ method: 'POST', url: '/api/cron/snapshot-earnings?test=1&force=1', headers: { host: 'offline.invalid' } }, response)
  expect(response.statusCode).toBe(202)
  expect(JSON.parse(payload)).toMatchObject({ retired: true, disabled: true })
  expect(response.setHeader).toHaveBeenCalledWith('cache-control', 'no-store')
  expect(fetcher).not.toHaveBeenCalled()
})

it.each([snapshot, summer, winter, fallback, finalCheck, golfSummer, golfWinter, afterSummer, afterWinter])('acknowledges a retired snapshot route, even when forced, without network work', async (handler) => {
  const fetcher = vi.fn(() => { throw new Error('Retired feature must not call upstream') })
  vi.stubGlobal('fetch', fetcher)
  const response = await handler(new Request('https://offline.invalid/api/cron/snapshot-earnings?test=1', { method: 'POST' }))
  if (!response) throw new Error('Expected a web response')
  expect(response.status).toBe(202)
  expect(await response.json()).toMatchObject({ retired: true, disabled: true })
  expect(fetcher).not.toHaveBeenCalled()
})

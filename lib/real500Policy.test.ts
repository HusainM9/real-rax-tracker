import { beforeEach, expect, it, vi } from 'vitest'
import { guardedUpstreamFetch } from './guardedUpstreamFetch'
import { memoryRequestSafetyStore } from '../src/testing/requestSafetyFake'

const store = memoryRequestSafetyStore()
beforeEach(() => { store.clear(); vi.spyOn(console, 'error').mockImplementation(() => {}) })

it('keeps the required confirmed Real HTTP 500 block across later query/account variants', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 500 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(guardedUpstreamFetch('real', 'https://real.test/earnings?account=one', {}, store)).rejects.toMatchObject({ upstreamStatus: 500 })
  await expect(guardedUpstreamFetch('real', 'https://real.test/earnings?account=two', {}, store)).rejects.toMatchObject({ upstreamStatus: 500 })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it.each([501, 502, 503, 504, 599])('does not turn Real HTTP %i into a permanent 500 ban', async status => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status })).mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  expect((await guardedUpstreamFetch('real', `https://real.test/status/${status}`, {}, store)).status).toBe(status)
  expect((await guardedUpstreamFetch('real', `https://real.test/status/${status}`, {}, store)).ok).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('does not permanently ban a Real endpoint after a lost response', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('Lost connection')).mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  await expect(guardedUpstreamFetch('real', 'https://real.test/uncertain', {}, store)).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect((await guardedUpstreamFetch('real', 'https://real.test/uncertain', {}, store)).ok).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('does not expose private transport text in a Real network failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('private-url?token=secret')))
  const error = await guardedUpstreamFetch('real', 'https://real.test/redacted-network', {}, store).catch(error => error)
  expect(error.message).not.toMatch(/private-url|token|secret/)
  expect(error.retryable).not.toBe(false)
})
it.each(['supabase-catalog', 'marketplace-notification', 'legacy-catalog'])('never latches %s HTTP 500 as a Real failure', async provider => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 })).mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  expect((await guardedUpstreamFetch(provider, 'https://internal.test/resource', {}, store)).status).toBe(500)
  expect((await guardedUpstreamFetch(provider, 'https://internal.test/resource', {}, store)).ok).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(2)
})

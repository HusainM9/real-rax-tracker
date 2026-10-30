import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { guardedUpstreamFetch } from './guardedUpstreamFetch'
import { memoryRequestSafetyStore } from '../src/testing/requestSafetyFake'

const store = memoryRequestSafetyStore()
beforeEach(() => { store.clear(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())

it('logs one redacted confirmed Real 500 and records the original family key', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('private body', { status: 500 }))
  vi.stubGlobal('fetch', fetcher)
  const write = vi.spyOn(store, 'recordFailure')
  await expect(guardedUpstreamFetch('real', 'https://provider.test/incident?token=secret', {}, store)).rejects.toMatchObject({ provider: 'real', upstreamStatus: 500, retryable: false })
  expect(write).toHaveBeenCalledWith(expect.stringMatching(/^request-safety:v1:[a-f0-9]{64}$/), expect.objectContaining({ provider: 'real', status: 500, recordedAt: expect.any(String), incidentId: expect.any(String) }))
  expect(console.error).toHaveBeenCalledWith('request-safety incident', expect.objectContaining({ provider: 'real', status: 500, action: 'real_endpoint_paused' }))
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/secret|provider.test|private body/)
  await expect(guardedUpstreamFetch('real', 'https://provider.test/incident?force=1', {}, store)).rejects.toMatchObject({ upstreamStatus: 500 })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('preserves a confirmed Real 500 across a fresh transport module', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 500 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(guardedUpstreamFetch('real', 'https://provider.test/persisted', {}, store)).rejects.toThrow()
  vi.resetModules()
  const { guardedUpstreamFetch: fresh } = await import('./guardedUpstreamFetch')
  await expect(fresh('real', 'https://provider.test/persisted?account=other', {}, store)).rejects.toMatchObject({ upstreamStatus: 500 })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('blocks queued same-family Real work after the first actual 500', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 500 }))
  vi.stubGlobal('fetch', fetcher)
  const results = await Promise.allSettled([1, 2, 3].map(id => guardedUpstreamFetch('real', `https://provider.test/queued?id=${id}`, {}, store)))
  expect(results.every(result => result.status === 'rejected')).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('keeps a warm Real 500 block if failure recording itself fails, without disabling another endpoint', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 })).mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  const failing = { ...store, recordFailure: async () => { throw new Error('Storage unavailable') } }
  await expect(guardedUpstreamFetch('real', 'https://provider.test/persistence-failure', {}, failing)).rejects.toMatchObject({ upstreamStatus: 500 })
  await expect(guardedUpstreamFetch('real', 'https://provider.test/persistence-failure?force=1', {}, failing)).rejects.toMatchObject({ upstreamStatus: 500 })
  expect((await guardedUpstreamFetch('real', 'https://provider.test/unrelated', {}, store)).ok).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('never needs safety storage for catalog or notification calls', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })))
  const unavailable = { ...store, getFailure: vi.fn().mockRejectedValue(new Error('Storage unavailable')) }
  expect((await guardedUpstreamFetch('supabase-catalog', 'https://catalog.test/passes', {}, unavailable)).ok).toBe(true)
  expect((await guardedUpstreamFetch('marketplace-notification', 'https://notification.test/send', {}, unavailable)).ok).toBe(true)
  expect(unavailable.getFailure).not.toHaveBeenCalled()
})
it('stops only the current Real operation if history cannot be read and permits normal later use', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  const read = vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue(null)
  const transient = { ...store, getFailure: read }
  const error = await guardedUpstreamFetch('real', 'https://provider.test/history-check', {}, transient).catch(error => error)
  expect(error.message).toContain('not started')
  expect(error.retryable).not.toBe(false)
  expect(fetcher).not.toHaveBeenCalled()
  expect((await guardedUpstreamFetch('real', 'https://provider.test/history-check', {}, transient)).ok).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('cancels before dispatch even if cancellation arrives during the history check', async () => {
  const controller = new AbortController()
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  const cancelled = { ...store, getFailure: async () => { controller.abort(); return null } }
  await expect(guardedUpstreamFetch('real', 'https://provider.test/cancelled', { signal: controller.signal }, cancelled)).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetcher).not.toHaveBeenCalled()
  expect((await guardedUpstreamFetch('real', 'https://provider.test/cancelled', {}, store)).ok).toBe(true)
})
it('does not write a reservation for a successful Real request', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })))
  const write = vi.spyOn(store, 'recordFailure')
  const read = vi.spyOn(store, 'getFailure')
  await guardedUpstreamFetch('real', 'https://provider.test/success', {}, store)
  expect(read).toHaveBeenCalledTimes(1)
  expect(write).not.toHaveBeenCalled()
})
it('honors a known stored Real 500 without sending HTTP', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const legacy = { ...store, getFailure: async () => ({ owner: 'legacy', status: 500 }) }
  await expect(guardedUpstreamFetch('real', 'https://provider.test/legacy', {}, legacy)).rejects.toMatchObject({ upstreamStatus: 500 })
  expect(fetcher).not.toHaveBeenCalled()
})
it('keeps the known UFC 500 blocked before any history or network call', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const read = vi.spyOn(store, 'getFailure')
  await expect(guardedUpstreamFetch('real', 'https://web.realapp.com/home/ufc/day?day=2026-11-01', {}, store)).rejects.toMatchObject({ upstreamStatus: 500, provider: 'real' })
  expect(fetcher).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
})

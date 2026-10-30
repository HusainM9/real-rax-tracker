import { expect, it, vi } from 'vitest'
import { safeFetch, safeImportFetch } from './safeImportFetch'

it.each(Array.from({ length: 100 }, (_, index) => 500 + index))('does not permanently ban an internal API after HTTP %i', async status => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'Internal failure' }, { status })).mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  expect((await safeFetch('/api/account/data')).status).toBe(status)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect((await safeFetch('/api/account/data')).ok).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('preserves explicit Real HTTP 500 metadata without poisoning a whole browser API route', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ provider: 'real', upstreamStatus: 500, retryable: false, error: 'Real endpoint paused. Reference: incident.' }, { status: 423 })).mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  await expect(safeImportFetch('/api/import/real-passes')).rejects.toMatchObject({ provider: 'real', upstreamStatus: 500, retryable: false })
  expect((await safeImportFetch('/api/import/real-passes?different-operation=1')).ok).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('retains successful partial results and their failed Real-500 metadata for the caller', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ passes: [{ id: 'ok' }], failures: [{ provider: 'real', upstreamStatus: 500, retryable: false }] })))
  const response = await safeImportFetch('/api/import/partial')
  expect(await response.json()).toMatchObject({ passes: [{ id: 'ok' }], failures: [{ upstreamStatus: 500, retryable: false }] })
})
it('does not persist page cancellation as a ban', async () => {
  const controller = new AbortController()
  const fetcher = vi.fn().mockImplementationOnce(() => { controller.abort(); throw new DOMException('Aborted', 'AbortError') }).mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  await expect(safeFetch('/api/catalog/season-years', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect((await safeFetch('/api/catalog/season-years')).ok).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('does not require localStorage for normal API access', async () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Storage unavailable') })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })))
  try { expect((await safeFetch('/api/account/session')).ok).toBe(true) }
  finally { read.mockRestore() }
})

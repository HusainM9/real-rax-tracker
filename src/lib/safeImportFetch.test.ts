import { expect, it, vi } from 'vitest'
import { safeImportFetch } from './safeImportFetch'

it('does not turn ordinary page cancellation into a persistent block for later queries', async () => {
  const controller = new AbortController()
  const fetcher = vi.fn().mockImplementationOnce(async () => { controller.abort(); throw new DOMException('Page cleanup', 'AbortError') }).mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  await expect(safeImportFetch('/api/catalog/season-years?sport=nba', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect((await safeImportFetch('/api/catalog/season-years?sport=nhl')).ok).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(Object.keys(localStorage).filter(key => key.startsWith('rax:request-safety:'))).toEqual([])
})
it('stops a network-uncertain browser operation once without permanently banning later route use', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('Lost connection')).mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  await expect(safeImportFetch('/api/account/data')).rejects.toMatchObject({ retryable: false, pending: true })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect((await safeImportFetch('/api/account/data', { method: 'PUT', body: '{}' })).ok).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('keeps new confirmed GET failures blocked without poisoning PUT on the same route', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  await expect(safeImportFetch('/api/account/data')).rejects.toMatchObject({ upstreamStatus: 503 })
  await expect(safeImportFetch('/api/account/data?force=true')).rejects.toMatchObject({ upstreamStatus: 503 })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect((await safeImportFetch('/api/account/data', { method: 'PUT', body: '{}' })).ok).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('preserves legacy unknown browser evidence without using it as a permanent route ban', async () => {
  const key = 'rax:request-safety:v1:https://example.com/api/account/data'
  const evidence = JSON.stringify({ recordedAt: '2026-10-31T00:00:00.000Z', action: 'paused_until_review' })
  localStorage.setItem(key, evidence)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })))
  // The test environment's origin is supplied explicitly to address the legacy key.
  expect((await safeImportFetch('https://example.com/api/account/data')).ok).toBe(true)
  expect(localStorage.getItem(key)).toBe(evidence)
})
it.each([
  JSON.stringify({ upstreamStatus: 500 }),
  '{malformed marker',
  'null',
  JSON.stringify({ upstreamStatus: '503' }),
])('honors legacy confirmed or malformed browser blocks without sending HTTP: %s', async marker => {
  localStorage.setItem('rax:request-safety:v1:https://example.com/api/legacy', marker)
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(safeImportFetch('https://example.com/api/legacy', { method: 'PUT' })).rejects.toMatchObject({ retryable: false })
  expect(fetcher).not.toHaveBeenCalled()
})

it('records and logs the first browser 5xx without exposing response data or repeating it', async () => {
  const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private response', { status: 502 })))
  await expect(safeImportFetch('/api/account/incident?token=secret')).rejects.toThrow()
  await expect(safeImportFetch('/api/account/incident?force=1')).rejects.toThrow()
  const marker = Object.values(localStorage).map(value => JSON.parse(value)).find(value => value.upstreamStatus === 502)
  expect(marker).toMatchObject({ upstreamStatus: 502, recordedAt: expect.any(String), action: 'paused_until_review' })
  expect(logger).toHaveBeenCalledTimes(1)
  expect(logger).toHaveBeenCalledWith('request-safety incident', expect.objectContaining({ source: 'browser', status: 502, action: 'paused_until_review' }))
  expect(JSON.stringify(logger.mock.calls)).not.toMatch(/secret|private response/)
})

it('blocks later manual retries and query variants after an API 5xx', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('gateway error', { status: 502 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(safeImportFetch('/api/import/safety-test?force=1')).rejects.toMatchObject({ upstreamStatus: 502, retryable: false })
  await expect(safeImportFetch('/api/import/safety-test?force=2')).rejects.toMatchObject({ upstreamStatus: 502, retryable: false })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('preserves partial successes but blocks future calls after embedded upstream 5xx', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ passes: [{ externalKey: 'ok' }], failures: [{ upstreamStatus: 500, retryable: false }] }))
  vi.stubGlobal('fetch', fetcher)
  expect((await (await safeImportFetch('/api/import/partial-test')).json()).passes).toHaveLength(1)
  await expect(safeImportFetch('/api/import/partial-test')).rejects.toMatchObject({ upstreamStatus: 500 })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it.each(Array.from({ length: 100 }, (_, index) => 500 + index))('blocks browser polling after HTTP %i', async (status) => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }))
  vi.stubGlobal('fetch', fetcher)
  await expect(safeImportFetch('/api/account/earnings')).rejects.toMatchObject({ upstreamStatus: status, retryable: false })
  await expect(safeImportFetch('/api/account/earnings?refresh=new')).rejects.toMatchObject({ upstreamStatus: status, retryable: false })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('keeps partial error-list status even when a wrapper responds with 200', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ errors: [{ upstreamStatus: 500, retryable: false }] }))
  vi.stubGlobal('fetch', fetcher)
  await safeImportFetch('/api/account/partial')
  await expect(safeImportFetch('/api/account/partial')).rejects.toMatchObject({ upstreamStatus: 500 })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('does not permanently latch an overlapping pending operation when no 5xx occurred', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ pending: true, retryable: false, error: 'Another request is pending' }, { status: 423 })).mockResolvedValueOnce(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  await expect(safeImportFetch('/api/import/pending')).rejects.toThrow()
  expect((await safeImportFetch('/api/import/pending')).ok).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('never allows a pending flag to override an actual 5xx block', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ pending: true, upstreamStatus: 503, retryable: false }, { status: 423 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(safeImportFetch('/api/import/pending')).rejects.toMatchObject({ upstreamStatus: 503 })
  await expect(safeImportFetch('/api/import/pending')).rejects.toMatchObject({ upstreamStatus: 503 })
  expect(fetcher).toHaveBeenCalledTimes(1)
})

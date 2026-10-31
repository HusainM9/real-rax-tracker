// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { safeFetch } from './safeImportFetch'

it('handles internal 500 normally and permits later manual use without a permanent browser ban', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'Internal issue' }, { status: 500 })).mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  expect((await safeFetch('/api/account/login', { method: 'POST' })).status).toBe(500)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect((await safeFetch('/api/account/login', { method: 'POST' })).ok).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it.each(['v1:', 'v2:POST:'])('ignores obsolete %s browser bans without deleting their evidence', async version => {
  const key = `rax:request-safety:${version}${window.location.origin}/api/account/login`
  const record = JSON.stringify({ upstreamStatus: 500 })
  localStorage.setItem(key, record)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })))
  expect((await safeFetch('/api/account/login', { method: 'POST' })).ok).toBe(true)
  expect(localStorage.getItem(key)).toBe(record)
})
it('does not classify a browser connection failure as a permanent non-retryable route ban', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('private transport message')).mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  const error = await safeFetch('/api/account/data').catch(error => error)
  expect(error).toBeInstanceOf(Error)
  expect(error.retryable).not.toBe(false)
  expect(error.message).not.toContain('private transport')
  expect((await safeFetch('/api/account/data')).ok).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(2)
})

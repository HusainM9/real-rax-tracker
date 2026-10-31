import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ append: vi.fn(), wait: vi.fn() }))
vi.mock('./operationalErrorStore', () => ({ appendOperationalErrors: mocks.append }))
vi.mock('@vercel/functions', () => ({ waitUntil: mocks.wait }))
import { withErrorLogging } from './withErrorLogging'
import { observeProviderError, inheritErrorObserver } from './operationalErrorReporter'
beforeEach(() => { vi.clearAllMocks(); mocks.append.mockResolvedValue(1); vi.spyOn(console, 'error').mockImplementation(() => {}) })

it.each([400, 401, 429, 500, 503])('records tracker HTTP %i without making it a confirmed Real 500', async status => {
  const wrapped = withErrorLogging('/api/account/login', async () => Response.json({ error: 'password=secret https://private.invalid', code: 'account_storage_unavailable' }, { status, headers: { 'Set-Cookie': 'session=private; HttpOnly', 'X-Existing': 'kept' } }))
  const response = await wrapped(new Request('https://offline.invalid/api/account/login?token=secret', { method: 'POST', body: 'private-body' }))
  expect(response.status).toBe(status)
  expect(response.headers.get('x-existing')).toBe('kept')
  expect(response.headers.get('set-cookie')).toContain('session=private')
  expect(response.headers.get('x-tracker-error-recorded')).toBe('1')
  expect(mocks.append).toHaveBeenCalledWith([expect.objectContaining({ status, source: 'storage', confirmedReal500: false })])
  expect(JSON.stringify(mocks.append.mock.calls)).not.toMatch(/secret|private|cookie|body/)
})
it('correlates nested provider failures without adding a second API error', async () => {
  const wrapped = withErrorLogging('/api/import/pack-ratings', async request => {
    const child = new AbortController(); inheritErrorObserver(request.signal, child.signal)
    observeProviderError('real', { kind: 'http', status: 503 }, child.signal)
    return Response.json({ error: 'private' }, { status: 502 })
  })
  await wrapped(new Request('https://offline.invalid/api/import/pack-ratings'))
  expect(mocks.append).toHaveBeenCalledTimes(1)
  expect(mocks.append).toHaveBeenCalledWith([expect.objectContaining({ source: 'real', status: 503, operation: '/api/import/pack-ratings' })])
})
it('does not wait on failed journal storage, retry the operation or leak unhandled exception text', async () => {
  mocks.append.mockRejectedValue(new Error('private storage password'))
  const handler = vi.fn(async () => { throw new Error('private exception token') })
  const response = await withErrorLogging('/api/account/data', handler)(new Request('https://offline.invalid/api/account/data'))
  expect(response.status).toBe(500); expect(await response.text()).not.toMatch(/private|token/)
  await Promise.all(mocks.wait.mock.calls.map(call => call[0]))
  expect(handler).toHaveBeenCalledTimes(1); expect(mocks.append).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/private|password|token/)
})
it('does no journal work for an ordinary successful operation', async () => {
  await withErrorLogging('/api/account/data', () => Response.json({ ok: true }))(new Request('https://offline.invalid/api/account/data'))
  expect(mocks.append).not.toHaveBeenCalled()
})
it('preserves separate session-cookie headers on a failed response', async () => {
  const headers = new Headers(); headers.append('Set-Cookie', 'first=fixture; HttpOnly'); headers.append('Set-Cookie', 'second=fixture; SameSite=Strict')
  const original = Response.json({ error: 'Rejected' }, { status: 401, headers })
  const response = await withErrorLogging('/api/account/login', () => original)(new Request('https://offline.invalid/api/account/login'))
  expect(response.headers.getSetCookie()).toEqual(original.headers.getSetCookie())
  expect(await response.json()).toEqual({ error: 'Rejected' })
})

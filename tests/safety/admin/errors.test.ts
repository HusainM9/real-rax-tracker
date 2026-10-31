import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ admin: vi.fn(), app: vi.fn(), list: vi.fn(), confirmed: vi.fn(), append: vi.fn() }))
vi.mock('../../../api/admin/_helpers', () => ({ requireAdminSession: mocks.admin, requireAppSession: mocks.app }))
vi.mock('../../../lib/operationalErrorStore', () => ({ listOperationalErrors: mocks.list, listConfirmedRealErrors: mocks.confirmed, appendOperationalErrors: mocks.append }))
import history from '../../../api/admin/errors'
import report from '../../../api/admin/error-report'
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue(null); mocks.app.mockResolvedValue(null); mocks.list.mockResolvedValue({ events: [], total: 0, nextCursor: null, partialSearch: false }); mocks.confirmed.mockResolvedValue([]); mocks.append.mockResolvedValue(1) })
it('requires an admin session before reading any error or safety history', async () => {
  mocks.admin.mockResolvedValue(Response.json({ error: 'Admin session required' }, { status: 401 }))
  expect((await history(new Request('https://offline.invalid/api/admin/errors'))).status).toBe(401)
  expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.confirmed).not.toHaveBeenCalled()
})
it('reads saved history with validated filters and reports unavailability rather than a healthy empty result', async () => {
  const response = await history(new Request('https://offline.invalid/api/admin/errors?source=real&status=503&query=packs&from=2026-10-01&to=2026-10-31'))
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ source: 'real', status: 503, query: 'packs', from: '2026-10-01', to: '2026-10-31' }))
  mocks.list.mockRejectedValue(new Error('private store URL password=secret'))
  const failed = await history(new Request('https://offline.invalid/api/admin/errors'))
  expect(failed.status).toBe(503)
  expect(await failed.text()).not.toMatch(/private|password|secret/)
})
it('rejects invalid filters and cursors without doing a history read', async () => {
  expect((await history(new Request('https://offline.invalid/api/admin/errors?status=NaN'))).status).toBe(400)
  expect(mocks.list).not.toHaveBeenCalled()
})
it('requires website access for reporting and strips forged authority and private report content', async () => {
  const request = () => new Request('https://offline.invalid/api/admin/error-report', { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), kind: 'http', status: 500, source: 'real', confirmedReal500: true, message: 'secret', stack: 'private', operation: '/cards' }) })
  mocks.app.mockResolvedValueOnce(Response.json({}, { status: 401 }))
  expect((await report(request())).status).toBe(401)
  expect(mocks.append).not.toHaveBeenCalled()
  expect((await report(request())).status).toBe(202)
  expect(mocks.append).toHaveBeenCalledWith([expect.objectContaining({ source: 'browser', reported: true, confirmedReal500: false, operation: '/cards' })])
  expect(JSON.stringify(mocks.append.mock.calls)).not.toMatch(/private|secret/)
})

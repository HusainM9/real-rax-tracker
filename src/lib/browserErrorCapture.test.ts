import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ report: vi.fn() }))
vi.mock('./browserErrorReporter', () => ({ reportBrowserError: mocks.report }))
import { safeFetch } from './safeImportFetch'
beforeEach(() => { vi.clearAllMocks() })
it('reports an unrecorded API failure without upgrading it to a provider failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'private' }, { status: 500 })))
  await safeFetch('/api/account/data?token=secret')
  expect(mocks.report).toHaveBeenCalledExactlyOnceWith({ kind: 'http', operation: '/api/account/data', status: 500 })
})
it('suppresses server duplicates and recursive journal failures', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status: 503, headers: { 'X-Tracker-Error-Recorded': '1' } })))
  await safeFetch('/api/account/data'); await safeFetch('/api/admin/errors'); await safeFetch('/api/admin/error-report')
  expect(mocks.report).not.toHaveBeenCalled()
})

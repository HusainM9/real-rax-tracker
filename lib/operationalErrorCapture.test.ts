import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ append: vi.fn() }))
vi.mock('./operationalErrorStore', () => ({ appendOperationalErrors: mocks.append }))
import { guardedUpstreamFetch } from './guardedUpstreamFetch'
import { memoryRequestSafetyStore } from '../src/testing/requestSafetyFake'
beforeEach(() => { vi.clearAllMocks(); mocks.append.mockResolvedValue(1); vi.spyOn(console, 'error').mockImplementation(() => {}) })
it.each([400, 401, 429, 500, 503])('captures actual provider HTTP %i with one provider dispatch and only blocks a confirmed 500', async status => {
  const store = memoryRequestSafetyStore(), record = vi.spyOn(store, 'recordFailure')
  const fetcher = vi.fn().mockResolvedValue(new Response('private body', { status }))
  vi.stubGlobal('fetch', fetcher)
  await guardedUpstreamFetch('real', `https://offline.invalid/capture-${status}?token=secret`, {}, store).catch(() => {})
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(mocks.append).toHaveBeenCalledWith([expect.objectContaining({ source: 'real', status, confirmedReal500: status === 500 })])
  expect(record).toHaveBeenCalledTimes(status === 500 ? 1 : 0)
  expect(JSON.stringify(mocks.append.mock.calls)).not.toMatch(/private|offline.invalid|secret/)
})
it('captures missing responses without guessing status, blocking, or replaying a request', async () => {
  const store = memoryRequestSafetyStore(), record = vi.spyOn(store, 'recordFailure')
  const fetcher = vi.fn().mockRejectedValue(new Error('private response unknown'))
  vi.stubGlobal('fetch', fetcher)
  await guardedUpstreamFetch('real', 'https://offline.invalid/lost-capture', {}, store).catch(() => {})
  expect(fetcher).toHaveBeenCalledTimes(1); expect(record).not.toHaveBeenCalled()
  expect(mocks.append.mock.calls[0]![0][0]).toMatchObject({ kind: 'network', confirmedReal500: false })
  expect(mocks.append.mock.calls[0]![0][0].status).toBeUndefined()
})

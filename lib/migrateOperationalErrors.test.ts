import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ lrange: vi.fn(), append: vi.fn(), get: vi.fn(), set: vi.fn() }))
vi.mock('./noRetryKv', () => ({ getNoRetryKv: () => mocks }))
vi.mock('./operationalErrorStore', () => ({ appendOperationalErrors: mocks.append }))
import { migrateRetainedImportErrors, ensureRetainedImportErrors } from './migrateOperationalErrors'
it('copies only safe retained import-error metadata with original time and id, without inferring status or changing old history', async () => {
  vi.clearAllMocks()
  const id = crypto.randomUUID(), at = '2026-10-30T20:00:00Z'
  mocks.lrange.mockResolvedValue([{ id, at, type: 'pass_fetch_error', message: '500 password=secret https://private.invalid', realUsername: 'private-user' }, { id: crypto.randomUUID(), at, type: 'import_complete' }])
  mocks.append.mockResolvedValue(1)
  expect(await migrateRetainedImportErrors()).toEqual({ examined: 2, eligible: 1, stored: 1 })
  expect(mocks.lrange).toHaveBeenCalledExactlyOnceWith('rax:events', 0, -1)
  const event = mocks.append.mock.calls[0]![0][0]
  expect(event).toMatchObject({ id, at, source: 'browser', reported: true, kind: 'unexpected', confirmedReal500: false })
  expect(event.status).toBeUndefined()
  expect(JSON.stringify(event)).not.toMatch(/secret|private/)
})
it('appends historical errors at the tail in newest-first order so live events remain above them', async () => {
  vi.clearAllMocks()
  const newest = { id: crypto.randomUUID(), at: '2026-10-30T20:00:00Z', type: 'pass_fetch_error' }
  const oldest = { id: crypto.randomUUID(), at: '2026-10-29T20:00:00Z', type: 'pass_fetch_error' }
  mocks.lrange.mockResolvedValue([newest, oldest]); mocks.append.mockResolvedValue(2)
  await migrateRetainedImportErrors()
  expect(mocks.append.mock.calls[0]![0].map((event: { id: string }) => event.id)).toEqual([newest.id, oldest.id])
  expect(mocks.append.mock.calls[0]![1]).toEqual({ historical: true })
})
it('checks a permanent completion marker and never removes or replays already-copied history', async () => {
  vi.clearAllMocks(); mocks.get.mockResolvedValue({ completedAt: '2026-10-31' })
  await ensureRetainedImportErrors()
  expect(mocks.lrange).not.toHaveBeenCalled(); expect(mocks.append).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled()
})
it('only records completion after a successful copy and permits a later explicit read after a storage failure', async () => {
  vi.clearAllMocks(); mocks.get.mockResolvedValue(null); mocks.lrange.mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue([]); mocks.set.mockResolvedValue('OK')
  await expect(ensureRetainedImportErrors()).rejects.toThrow()
  expect(mocks.set).not.toHaveBeenCalled()
  await ensureRetainedImportErrors()
  expect(mocks.set).toHaveBeenCalledTimes(1)
  expect(mocks.set.mock.calls[0]).toHaveLength(2) // No expiry or latches on application requests.
})

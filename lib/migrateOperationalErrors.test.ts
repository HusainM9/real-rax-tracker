import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ lrange: vi.fn(), append: vi.fn() }))
vi.mock('./noRetryKv', () => ({ getNoRetryKv: () => ({ lrange: mocks.lrange }) }))
vi.mock('./operationalErrorStore', () => ({ appendOperationalErrors: mocks.append }))
import { migrateRetainedImportErrors } from './migrateOperationalErrors'
it('copies only safe retained import-error metadata with original time and id, without inferring status or changing old history', async () => {
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

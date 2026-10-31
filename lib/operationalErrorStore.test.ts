import { beforeEach, expect, it, vi } from 'vitest'
import { createOperationalError } from './operationalErrorTypes'
const mocks = vi.hoisted(() => ({ eval: vi.fn(), lrange: vi.fn(), scan: vi.fn(), get: vi.fn() }))
vi.mock('./noRetryKv', () => ({ getNoRetryKv: () => mocks }))
import { appendOperationalErrors, listOperationalErrors, listConfirmedRealErrors } from './operationalErrorStore'
beforeEach(() => { vi.clearAllMocks(); mocks.eval.mockResolvedValue(1); mocks.lrange.mockResolvedValue([]); mocks.scan.mockResolvedValue([0, []]) })

it('appends atomically without expiry, trimming or unsafe fields and deduplicates resubmissions', async () => {
  const event = createOperationalError({ source: 'tracker', kind: 'http', status: 400 })
  await appendOperationalErrors([event, event])
  expect(mocks.eval).toHaveBeenCalledTimes(1)
  const [script, , args] = mocks.eval.mock.calls[0]!
  expect(script).toMatch(/SADD/)
  expect(script).toMatch(/LPUSH/)
  expect(script).not.toMatch(/LTRIM|EXPIRE|DEL\b/)
  expect(JSON.parse(args[0])).toHaveLength(1)
})
it('searches older stored segments and returns an honest continuation when a segment is exhausted', async () => {
  const old = createOperationalError({ source: 'browser', kind: 'network' })
  const wanted = createOperationalError({ source: 'real', kind: 'http', status: 503, operation: '/api/import/pack-ratings' })
  mocks.eval.mockResolvedValueOnce([1002, Array.from({ length: 200 }, () => JSON.stringify(old))])
    .mockResolvedValueOnce([1002, [JSON.stringify(wanted)]])
  const result = await listOperationalErrors({ query: 'packs', limit: 1 })
  expect(result.events).toEqual([wanted])
  expect(result.total).toBe(1002)
  expect(result.nextCursor).not.toBeNull()
  expect(mocks.eval.mock.calls[1]![2]).toEqual(expect.arrayContaining([1002, 200]))
})
it('keeps pagination tied to its original snapshot and rejects invalid cursors', async () => {
  const event = createOperationalError({ source: 'tracker', kind: 'http', status: 500 })
  mocks.eval.mockResolvedValue([102, [JSON.stringify(event)]])
  const result = await listOperationalErrors({ cursor: '100:50', limit: 1 })
  expect(mocks.eval.mock.calls[0]![2].slice(0, 2)).toEqual([100, 50])
  expect(result.nextCursor).toBe('100:51')
  await expect(listOperationalErrors({ cursor: 'not-a-cursor' })).rejects.toThrow(/cursor/i)
})
it('preserves confirmed legacy Real evidence without classifying old unknown/non-500 entries as confirmed', async () => {
  const keys = ['a', 'b', 'c'].map(char => `request-safety:v1:${char.repeat(64)}`)
  mocks.scan.mockResolvedValue([0, keys])
  mocks.get.mockImplementation(async (key: string) => key === keys[0] ? { status: 500, provider: 'real', incidentId: crypto.randomUUID(), recordedAt: '2026-10-30T20:00:00Z' } : key === keys[1] ? { status: 503, provider: 'real' } : { outcome: 'transport_unknown' })
  const result = await listConfirmedRealErrors()
  expect(result).toHaveLength(2) // One stored confirmed incident and the known historical UFC protection.
  expect(result.some(row => row.operation === 'real_ufc_day' && row.at === null)).toBe(true)
  expect(result.every(row => row.confirmedReal500 && row.status === 500)).toBe(true)
  expect(mocks.eval).not.toHaveBeenCalled()
})

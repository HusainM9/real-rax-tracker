import { beforeEach, expect, it, vi } from 'vitest'
vi.unmock('./requestSafetyStore')
vi.unmock('./noRetryKv')
const mocks = vi.hoisted(() => ({ set: vi.fn(), get: vi.fn(), eval: vi.fn(), create: vi.fn(), use: vi.fn() }))
vi.mock('@vercel/kv', () => ({ createClient: mocks.create }))
import { requestSafetyStore } from './requestSafetyStore'

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('KV_REST_API_URL', 'https://offline.invalid')
  vi.stubEnv('KV_REST_API_TOKEN', 'fixture-token')
  mocks.create.mockReturnValue(mocks)
})

it('reserves atomically without TTL or SDK transport retries', async () => {
  mocks.set.mockResolvedValue('OK')
  expect(await requestSafetyStore.reserve('hashed-key', 'owner')).toBeNull()
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ retry: { retries: 0 }, enableAutoPipelining: false }))
  expect(mocks.set).toHaveBeenCalledWith('hashed-key', { owner: 'owner', reservedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) }, { nx: true })
})
it('retains an uncertain incident without inventing a status or releasing its reservation', async () => {
  mocks.eval.mockResolvedValue(1)
  const { requestSafetyStore: fresh } = await import('./requestSafetyStore')
  const context = { provider: 'real', method: 'GET', recordedAt: '2026-10-31T00:00:00.000Z', outcome: 'transport_unknown' as const, reason: 'connection_reset', incidentId: 'incident-id' }
  await fresh.finish('hashed-key', 'owner', undefined, context)
  expect(mocks.eval).toHaveBeenCalledWith(expect.any(String), ['hashed-key'], ['owner', '', 'real', 'GET', '2026-10-31T00:00:00.000Z', JSON.stringify({ outcome: 'transport_unknown', reason: 'connection_reset', incidentId: 'incident-id' }), ''])
})
it('reads existing durable failure metadata for a new caller', async () => {
  mocks.set.mockResolvedValue(null)
  mocks.get.mockResolvedValue({ owner: 'earlier-process', status: 500 })
  expect(await requestSafetyStore.reserve('hashed-key', 'new-owner')).toEqual({ owner: 'earlier-process', status: 500 })
})
it('atomically scopes catalog admission within the original family key', async () => {
  mocks.eval.mockResolvedValue(null)
  const { requestSafetyStore: fresh } = await import('./requestSafetyStore')
  expect(await fresh.reserve('original-family', 'owner', 'query-hash')).toBeNull()
  expect(mocks.eval).toHaveBeenCalledWith(expect.any(String), ['original-family'], ['owner', expect.any(String), 'query-hash'])
  expect(mocks.set).not.toHaveBeenCalled()
  expect(mocks.get).not.toHaveBeenCalled()
})
it.each([{ owner: 'legacy' }, { owner: 'legacy', status: 503 }])('retains a legacy family block during scoped admission: %j', async record => {
  mocks.eval.mockResolvedValue(record)
  const { requestSafetyStore: fresh } = await import('./requestSafetyStore')
  expect(await fresh.reserve('original-family', 'new-owner', 'query-hash')).toEqual(record)
  expect(mocks.set).not.toHaveBeenCalled()
})
it('passes scoped completion to the same atomic family record and refuses an owner mismatch', async () => {
  mocks.eval.mockResolvedValue(0)
  const { requestSafetyStore: fresh } = await import('./requestSafetyStore')
  await expect(fresh.finish('original-family', 'wrong-owner', undefined, undefined, 'query-hash')).rejects.toThrow('could not be finalized')
  expect(mocks.eval).toHaveBeenCalledWith(expect.any(String), ['original-family'], ['wrong-owner', '', '', '', '', '', 'query-hash'])
})
it.each([undefined, false, [], {}, { owner: 123 }])('fails closed on invalid scoped admission reply: %j', async reply => {
  mocks.eval.mockResolvedValue(reply)
  const { requestSafetyStore: fresh } = await import('./requestSafetyStore')
  await expect(fresh.reserve('family', 'owner', 'query-hash')).rejects.toThrow('Invalid request-safety record')
})
it('uses owner-checked atomic finalization and retains 5xx metadata', async () => {
  mocks.eval.mockResolvedValue(1)
  await requestSafetyStore.finish('hashed-key', 'owner', 502)
  expect(mocks.eval).toHaveBeenCalledWith(expect.stringContaining('record.owner ~= ARGV[1]'), ['hashed-key'], ['owner', 502, '', '', '', '', ''])
})
it('records first failure time and redacted context in the same atomic write as the block', async () => {
  mocks.eval.mockResolvedValue(1)
  await requestSafetyStore.finish('hashed-key', 'owner', 503, { provider: 'real', method: 'GET', recordedAt: '2026-10-31T00:00:00.000Z' })
  expect(mocks.eval).toHaveBeenCalledWith(expect.stringContaining('record.recordedAt'), ['hashed-key'], ['owner', 503, 'real', 'GET', '2026-10-31T00:00:00.000Z', '{}', ''])
})
it('refuses admission without durable storage credentials', async () => {
  vi.stubEnv('KV_REST_API_URL', '')
  const { requestSafetyStore: fresh } = await import('./requestSafetyStore')
  await expect(fresh.reserve('key', 'owner')).rejects.toThrow('not configured')
  expect(mocks.create).not.toHaveBeenCalled()
})

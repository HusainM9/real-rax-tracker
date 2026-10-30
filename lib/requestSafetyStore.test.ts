import { beforeEach, expect, it, vi } from 'vitest'
vi.unmock('./requestSafetyStore')
vi.unmock('./noRetryKv')
const mocks = vi.hoisted(() => ({ get: vi.fn(), eval: vi.fn(), set: vi.fn(), create: vi.fn() }))
vi.mock('@vercel/kv', () => ({ createClient: mocks.create }))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('KV_REST_API_URL', 'https://offline.invalid')
  vi.stubEnv('KV_REST_API_TOKEN', 'fixture-token')
  mocks.create.mockReturnValue(mocks)
})
it('reads an old confirmed 500 from the unchanged family key without creating a reservation', async () => {
  mocks.get.mockResolvedValue({ owner: 'earlier', status: 500 })
  const { requestSafetyStore } = await import('./requestSafetyStore')
  expect(await requestSafetyStore.getFailure('original-family')).toEqual({ owner: 'earlier', status: 500 })
  expect(mocks.get).toHaveBeenCalledWith('original-family')
  expect(mocks.set).not.toHaveBeenCalled()
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ retry: { retries: 0 } }))
})
it.each([
  null, 'unclassified', { owner: 'legacy' }, { owner: 'legacy', outcome: 'transport_unknown' },
  { owner: 'old', status: 503 }, { owner: 'old', status: 500, provider: 'supabase-catalog' },
])('does not treat unknown/non-Real/non-500 evidence as an admission ban: %j', async record => {
  mocks.get.mockResolvedValue(record)
  const { requestSafetyStore } = await import('./requestSafetyStore')
  expect(await requestSafetyStore.getFailure('family')).toBeNull()
  expect(mocks.set).not.toHaveBeenCalled()
  expect(mocks.eval).not.toHaveBeenCalled()
})
it('preserves a confirmed 500 nested in the former operation envelope', async () => {
  const failure = { owner: 'known', provider: 'real', status: 500 }
  mocks.get.mockResolvedValue({ version: 2, status: 503, operations: { earlier: { owner: 'other', status: 503 }, actual: failure } })
  const { requestSafetyStore } = await import('./requestSafetyStore')
  expect(await requestSafetyStore.getFailure('family')).toEqual(failure)
})
it('writes only an actual Real 500 atomically to its original family key', async () => {
  mocks.eval.mockResolvedValue(1)
  const { requestSafetyStore } = await import('./requestSafetyStore')
  const failure = { owner: 'incident', provider: 'real', method: 'GET', status: 500, recordedAt: '2026-10-31T00:00:00.000Z' }
  await requestSafetyStore.recordFailure('family', failure)
  expect(mocks.eval).toHaveBeenCalledWith(expect.any(String), ['family'], [JSON.stringify(failure)])
  expect(mocks.set).not.toHaveBeenCalled()
})
it.each([{ owner: 'other', status: 503, provider: 'real' }, { owner: 'other', status: 500, provider: 'kv' }])('rejects recording a non-Real-500 failure: %j', async failure => {
  const { requestSafetyStore } = await import('./requestSafetyStore')
  await expect(requestSafetyStore.recordFailure('family', failure)).rejects.toThrow('Only confirmed Real HTTP 500')
  expect(mocks.eval).not.toHaveBeenCalled()
})
it('surfaces failed persistence instead of pretending the Real block was saved', async () => {
  mocks.eval.mockResolvedValue(0)
  const { requestSafetyStore } = await import('./requestSafetyStore')
  await expect(requestSafetyStore.recordFailure('family', { owner: 'known', status: 500, provider: 'real' })).rejects.toThrow('could not be saved')
})

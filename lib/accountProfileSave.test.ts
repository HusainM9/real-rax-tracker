import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), sadd: vi.fn(), eval: vi.fn() }))
vi.mock('./noRetryKv', () => ({ kv: mocks }))
import { saveAccountProfileForSession } from './trackerProfileStore'

const revision = '2026-11-05T12:00:00.000Z'
const existing = { username: 'fixture', passphraseHash: 'fixture-hash', credentialsUpdatedAt: '',
  updatedAt: revision, cardCount: 0, performanceCount: 0, data: { cards: [], performances: [] } }
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('KV_REST_API_URL', 'https://storage.offline.invalid')
  vi.stubEnv('KV_REST_API_TOKEN', 'fixture-token')
  mocks.get.mockImplementation(async (key: string) => key.startsWith('rax:tracker-auth:')
    ? { passphraseHash: 'fixture-hash', credentialsUpdatedAt: '' } : existing)
  mocks.eval.mockResolvedValue([1])
})

it('checks the expected revision atomically with the profile write and advances an equal-millisecond revision', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(revision))
  try {
    const result = await saveAccountProfileForSession({ username: 'fixture', data: existing.data, ifUnmodifiedSince: revision })
    expect(result.ok).toBe(true)
    expect(mocks.set).not.toHaveBeenCalled()
    expect(mocks.eval).toHaveBeenCalledTimes(1)
    const [script, keys, args] = mocks.eval.mock.calls[0]!
    expect(keys).toEqual(['rax:tracker-profile:fixture'])
    expect(args[0]).toBe(revision)
    expect(script).toMatch(/redis.call\('GET'/)
    expect(script).toMatch(/current.updatedAt ~= ARGV\[1\]/)
    expect(script).toMatch(/redis.call\('SET'/)
    expect(Date.parse(JSON.parse(args[1]).updatedAt)).toBeGreaterThan(Date.parse(revision))
  } finally { vi.useRealTimers() }
})

it('returns the winning revision when another save wins after the initial read, without overwriting it', async () => {
  mocks.eval.mockResolvedValueOnce([2, '2026-11-05T12:01:00.000Z', 3, 4])
  const result = await saveAccountProfileForSession({ username: 'fixture', data: existing.data, ifUnmodifiedSince: revision })
  expect(result).toMatchObject({ ok: false, conflict: true, existingMeta: { updatedAt: '2026-11-05T12:01:00.000Z', cardCount: 3, performanceCount: 4 } })
  expect(mocks.set).not.toHaveBeenCalled()
  expect(mocks.sadd).not.toHaveBeenCalled()
})

it('does not recreate a deleted profile or retry an unavailable storage command', async () => {
  mocks.eval.mockResolvedValueOnce([0])
  expect(await saveAccountProfileForSession({ username: 'fixture', data: existing.data, ifUnmodifiedSince: revision }))
    .toMatchObject({ ok: false, notFound: true })
  mocks.eval.mockRejectedValueOnce(new Error('Storage unavailable'))
  await expect(saveAccountProfileForSession({ username: 'fixture', data: existing.data, ifUnmodifiedSince: revision })).rejects.toThrow('Storage unavailable')
  expect(mocks.eval).toHaveBeenCalledTimes(2)
  expect(mocks.set).not.toHaveBeenCalled()
})

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealApiContext } from './realApi'

const mocks = vi.hoisted(() => ({
  user: vi.fn(), passes: vi.fn(), get: vi.fn(), set: vi.fn(), configured: false,
  stored: new Map<string, unknown>(),
}))
vi.mock('./realApi', async (original) => ({
  ...await original<typeof import('./realApi')>(), getUserByUsername: mocks.user, listPasses: mocks.passes,
}))
vi.mock('@vercel/kv', () => ({ kv: { get: mocks.get, set: mocks.set } }))
vi.mock('./adminEventStore', () => ({ adminStorageConfigured: () => mocks.configured }))

const config: RealApiContext['config'] = {
  baseUrl: 'https://real.example.test', authInfo: 'private-auth', sessionToken: 'private-session',
  deviceUuid: 'device', deviceName: 'browser', deviceType: 'desktop_web', version: '35',
  timeoutMs: 12000, concurrency: 2, maxRetries: 0, retryBaseMs: 0, retryMaxMs: 0,
}
const passes = [{ id: 1, entityId: 551, entityType: 'player', season: 2026, sport: 'nba', label: 'Player', boostInfo: { rarityLabel: 'Iconic 1', progress: 30 } }]
const load = async () => (await import('./realOwnershipSnapshot')).getRealOwnershipSnapshot
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.configured = false
  mocks.stored.clear()
  mocks.user.mockResolvedValue({ id: 'user-id', userName: 'gordon' })
  mocks.passes.mockResolvedValue(passes)
  mocks.get.mockImplementation(async (key: string) => mocks.stored.get(key) ?? null)
  mocks.set.mockImplementation(async (key: string, value: unknown) => { mocks.stored.set(key, value); return 'OK' })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-30T17:00:00Z'))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('shared ownership snapshots', () => {
  it('reuses a successful normalized-username scan and returns its original freshness', async () => {
    const get = await load()
    const first = await get(' @Gordon ', { config })
    vi.setSystemTime(Date.now() + 5000)
    const second = await get('gordon', { config })
    expect(first.source).toBe('real')
    expect(second.source).toBe('cache')
    expect(second.fetchedAt).toBe(first.fetchedAt)
    expect(second.passes).toEqual(passes)
    expect(mocks.passes).toHaveBeenCalledTimes(1)
  })

  it('refreshes expired snapshots and preserves a legitimate newly empty collection', async () => {
    const get = await load()
    await get('gordon', { config })
    mocks.passes.mockResolvedValue([])
    vi.setSystemTime(Date.now() + 31000)
    expect((await get('gordon', { config })).passes).toEqual([])
    expect((await get('gordon', { config })).source).toBe('cache')
    expect(mocks.passes).toHaveBeenCalledTimes(2)
  })

  it('force refresh bypasses a fresh snapshot and replaces removed ownership', async () => {
    const get = await load()
    await get('gordon', { config })
    mocks.passes.mockResolvedValue([])
    const fresh = await get('gordon', { config }, { forceRefresh: true })
    expect(fresh).toMatchObject({ passes: [], source: 'real' })
    expect((await get('gordon', { config })).passes).toEqual([])
    expect(mocks.passes).toHaveBeenCalledTimes(2)
  })

  it('does not reuse snapshots across provider sessions or usernames', async () => {
    const get = await load()
    await get('gordon', { config })
    await get('gordon', { config: { ...config, sessionToken: 'new-session' } })
    mocks.user.mockResolvedValue({ id: 'other-user', userName: 'alice' })
    await get('alice', { config })
    expect(mocks.passes).toHaveBeenCalledTimes(3)
  })

  it('deduplicates simultaneous callers and isolates cancellation of one waiter', async () => {
    const get = await load()
    let release!: (value: typeof passes) => void
    mocks.passes.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const controller = new AbortController()
    const cancelled = get('gordon', { config, signal: controller.signal })
    const survivor = get('@gordon', { config })
    await vi.waitFor(() => expect(mocks.passes).toHaveBeenCalledTimes(1))
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    release(passes)
    expect((await survivor).passes).toEqual(passes)
    expect((await get('gordon', { config })).source).toBe('cache')
  })

  it('does not cache failures or malformed pass responses', async () => {
    const get = await load()
    mocks.passes.mockRejectedValueOnce(new Error('rate limited'))
    await expect(get('gordon', { config })).rejects.toThrow('rate limited')
    mocks.passes.mockResolvedValueOnce(null)
    await expect(get('gordon', { config })).rejects.toThrow(/invalid|malformed/i)
    expect((await get('gordon', { config })).passes).toEqual(passes)
    expect(mocks.passes).toHaveBeenCalledTimes(3)
  })

  it('reuses the optional durable snapshot across instances without storing credentials', async () => {
    mocks.configured = true
    const get = await load()
    await get('gordon', { config })
    expect(mocks.stored.size).toBe(1)
    expect(JSON.stringify([...mocks.stored])).not.toMatch(/private-auth|private-session/)
    vi.resetModules()
    const otherInstance = await load()
    expect((await otherInstance('gordon', { config })).source).toBe('cache')
    expect(mocks.passes).toHaveBeenCalledTimes(1)
  })

  it('falls back to Real if optional durable storage fails', async () => {
    mocks.configured = true
    mocks.get.mockRejectedValueOnce(new Error('KV unavailable'))
    mocks.set.mockRejectedValueOnce(new Error('KV unavailable'))
    expect((await (await load())('gordon', { config })).passes).toEqual(passes)
  })
})

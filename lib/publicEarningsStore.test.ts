import { beforeEach, describe, expect, it, vi } from 'vitest'
const store = vi.hoisted(() => ({ smembers: vi.fn(), mget: vi.fn() }))
vi.mock('@vercel/kv', () => ({ kv: store }))
vi.mock('./adminEventStore.js', () => ({ adminStorageConfigured: () => true }))
vi.mock('./realApi.js', () => ({ normalizeRealUsernameInput: (value: string) => value.replace(/^@/, '').trim() }))
import { listPublicEarningsSnapshots } from './publicEarningsStore'

beforeEach(() => { store.smembers.mockReset(); store.mget.mockReset() })
describe('public earnings history retrieval', () => {
  it('batches long history with MGET, skips missing snapshots and keeps dates ordered', async () => {
    const days = Array.from({ length: 100 }, (_, index) => new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10))
    store.smembers.mockResolvedValue(days)
    store.mget.mockImplementation(async (...keys: string[]) => keys.map((key) => key.endsWith('2026-01-01') ? null : { username: 'alpha', day: key.slice(-10) }))
    const rows = await listPublicEarningsSnapshots(['@Alpha', 'alpha'], 365)
    expect(store.smembers).toHaveBeenCalledTimes(1)
    expect(store.mget).toHaveBeenCalledTimes(4)
    expect(store.mget.mock.calls.every((keys) => keys.length <= 30)).toBe(true)
    expect(rows).toHaveLength(99)
    expect(rows[0]?.day).toBe('2026-01-02')
    expect(rows.at(-1)?.day).toBe('2026-04-10')
  })
})

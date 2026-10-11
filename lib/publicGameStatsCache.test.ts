import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPublicGameStatsMemoryCache,
  publicGameStatsKey,
  readPublicGameStatsCache,
  writePublicGameStatsCache,
} from './publicGameStatsCache'

beforeEach(() => {
  vi.stubEnv('KV_REST_API_URL', '')
  vi.stubEnv('KV_REST_API_TOKEN', '')
  clearPublicGameStatsMemoryCache()
})

describe('public final-game stats cache', () => {
  it('shares final game rows by sport and game id', async () => {
    const key = publicGameStatsKey('NFL', 19527)
    await writePublicGameStatsCache([{
      key,
      rows: [{ id: 100, playerId: 200, statValues: [{ type: 30, value: 2 }] }],
      cachedAt: '2026-10-12T10:30:00.000Z',
    }])

    expect((await readPublicGameStatsCache([key])).get(key)?.rows).toEqual([
      { id: 100, playerId: 200, statValues: [{ type: 30, value: 2 }] },
    ])
  })
})

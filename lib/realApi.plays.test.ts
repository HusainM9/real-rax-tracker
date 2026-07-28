import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  listAllPlayerRecentPlays,
  listPlayerPlaysForPackAverage,
  listPlayerRecentPlays,
  listPlayerTopPlays,
  type RealApiConfig,
} from './realApi'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function testConfig(): RealApiConfig {
  return {
    baseUrl: 'https://web.realapp.test',
    authInfo: 'user!token!device',
    sessionToken: '0123456789abcdef',
    deviceUuid: 'device-uuid',
    deviceName: 'test',
    deviceType: 'desktop_web',
    version: '35',
    timeoutMs: 5_000,
    concurrency: 2,
    maxRetries: 1,
    retryBaseMs: 1,
    retryMaxMs: 2,
  }
}

describe('listPlayerRecentPlays', () => {
  it('calls /players/.../plays/recent with season and viewFrame', async () => {
    const urls: string[] = []
    globalThis.fetch = vi.fn(async (input) => {
      urls.push(String(input))
      return new Response(JSON.stringify({ plays: [{ id: 1, value: '3.5', day: '2026-07-01' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const plays = await listPlayerRecentPlays(
      { entityId: 678882, sport: 'mlb', season: 2026, limit: 10 },
      { config: testConfig() },
    )
    expect(plays).toHaveLength(1)
    expect(plays[0]?.value).toBe('3.5')
    expect(urls[0]).toContain('/players/678882/sport/mlb/plays/recent')
    expect(urls[0]).toContain('season=2026')
    expect(urls[0]).toContain('viewFrame=default')
    expect(urls[0]).toContain('limit=10')
  })
})

describe('listPlayerTopPlays', () => {
  it('calls /players/.../plays/top with viewFrame=season by default', async () => {
    const urls: string[] = []
    globalThis.fetch = vi.fn(async (input) => {
      urls.push(String(input))
      return new Response(
        JSON.stringify({ plays: [{ id: 2, value: '-6.5', day: '2022-05-19' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    const plays = await listPlayerTopPlays(
      { entityId: 664285, sport: 'mlb', season: 2022, limit: 1000 },
      { config: testConfig() },
    )
    expect(plays).toHaveLength(1)
    expect(plays[0]?.value).toBe('-6.5')
    expect(urls[0]).toContain('/players/664285/sport/mlb/plays/top')
    expect(urls[0]).toContain('season=2022')
    expect(urls[0]).toContain('viewFrame=season')
    expect(urls[0]).toContain('limit=1000')
  })
})

describe('listPlayerPlaysForPackAverage', () => {
  it('uses /plays/top when the season sample is non-empty (MLB pitcher path)', async () => {
    const urls: string[] = []
    globalThis.fetch = vi.fn(async (input) => {
      urls.push(String(input))
      return new Response(
        JSON.stringify({ plays: [{ id: 2, value: '-6.5', day: '2022-05-19' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    const result = await listPlayerPlaysForPackAverage(
      { entityId: 664285, sport: 'mlb', season: 2022, limit: 100 },
      { config: testConfig() },
    )
    expect(result.source).toBe('top')
    expect(result.plays).toHaveLength(1)
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('/plays/top')
    expect(urls[0]).toContain('viewFrame=season')
  })

  it('falls back to /plays/recent when top is empty (NFL/NHL season safety)', async () => {
    const urls: string[] = []
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input)
      urls.push(url)
      if (url.includes('/plays/top')) {
        return new Response(JSON.stringify({ plays: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({ plays: [{ id: 9, value: '3.8', day: '2025-11-02' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    const result = await listPlayerPlaysForPackAverage(
      { entityId: 24120, sport: 'nfl', season: 2026, limit: 25 },
      { config: testConfig() },
    )
    expect(result.source).toBe('recent')
    expect(result.plays).toHaveLength(1)
    expect(result.plays[0]?.value).toBe('3.8')
    expect(urls.some((url) => url.includes('/sport/nfl/plays/top'))).toBe(true)
    expect(urls.some((url) => url.includes('/sport/nfl/plays/recent'))).toBe(true)
  })

  it('falls back to /plays/recent when top errors', async () => {
    const urls: string[] = []
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input)
      urls.push(url)
      if (url.includes('/plays/top')) {
        return new Response('Internal Server Error', { status: 500 })
      }
      return new Response(
        JSON.stringify({ plays: [{ id: 1, value: '4.2', day: '2025-01-10' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    const result = await listPlayerPlaysForPackAverage(
      { entityId: 20001874, sport: 'nba', season: 2025, limit: 25 },
      { config: testConfig() },
    )
    expect(result.source).toBe('recent')
    expect(result.plays[0]?.value).toBe('4.2')
  })
})

describe('listAllPlayerRecentPlays', () => {
  it('paginates with beforeDay until a short page', async () => {
    const urls: string[] = []
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input)
      urls.push(url)
      if (url.includes('beforeDay=')) {
        return new Response(
          JSON.stringify({
            plays: [{ id: 3, value: '2', day: '2026-06-01' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({
          plays: Array.from({ length: 2 }, (_, i) => ({
            id: i + 1,
            value: '5',
            day: '2026-07-10',
          })),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    const plays = await listAllPlayerRecentPlays(
      { entityId: 1, sport: 'mlb', season: 2026 },
      { config: testConfig() },
      { pageSize: 2, maxPages: 5 },
    )
    expect(plays).toHaveLength(3)
    expect(urls.some((url) => url.includes('beforeDay=2026-07-10'))).toBe(true)
  })
})

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let rawPasses: unknown
let malformed = false
const fetcher = vi.fn(async (input: RequestInfo | URL) => {
  if (String(input).includes('/user/')) return Response.json({ user: { id: 'real-user', userName: 'gordon', avatarUrl: 'https://media.realapp.com/example.webp' } })
  if (String(input).includes('/passes')) return Response.json(malformed ? {} : { passes: rawPasses })
  throw new Error('Unexpected upstream request')
})
const request = (forceRefresh = false) => new Request('https://example.test/api/import/pack-ratings', {
  method: 'POST', body: JSON.stringify({ username: 'gordon', forceRefresh }), headers: { 'content-type': 'application/json' },
})
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  for (const [key, value] of Object.entries({
    REAL_IMPORT_ENABLED: 'true', REAL_AUTH_INFO: 'test!token!device', REAL_SESSION_TOKEN: '0123456789abcdef',
    REAL_DEVICE_UUID: 'device', REAL_BASE_URL: 'https://real.example.test', BASIC_AUTH_PASSWORD: '',
    KV_REST_API_URL: '', KV_REST_API_TOKEN: '', NODE_ENV: 'production',
  })) vi.stubEnv(key, value)
  vi.stubGlobal('fetch', fetcher)
  malformed = false
  rawPasses = [{ entityType: 'player', entityId: 1, sport: 'nba', season: 2026, seasonDisplay: '2026-27', label: 'Player', boostInfo: { rarityLabel: 'Iconic 1', progress: 30 } }]
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('pack ratings ownership snapshots', () => {
  it.each([
    ['nhl', 2026, '2026-27', 2027, 'NHL'],
    ['nhl', 2027, '2026-27', 2027, 'NHL'],
    ['nhl', 2026, undefined, 2027, 'NHL'],
    ['nhl', 2025, '2024-25', 2025, 'NHL'],
    ['nba', 2026, '2026-27', 2027, 'NBA'],
    ['ncaam', 2025, '2025-26', 2026, 'CBB'],
    ['nfl', 2026, '2026-27', 2026, 'NFL'],
  ])('matches %s raw year %s / %s to catalog year %s', async (sport, season, seasonDisplay, expectedYear, displaySport) => {
    rawPasses = [{ entityType: 'player', entityId: 8471675, sport, season, seasonDisplay, label: 'Player', boostInfo: { rarityLabel: 'Legendary 1', progress: 20 } }]
    const handler = (await import('./pack-ratings')).default
    const result = await (await handler(request())).json()
    expect(result.passes).toEqual([expect.objectContaining({ externalKey: `8471675|${expectedYear}|${displaySport}`, seasonYear: expectedYear, rating: 400 })])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('returns freshness, reuses complete scans and honors forced refresh', async () => {
    const handler = (await import('./pack-ratings')).default
    const first = await (await handler(request())).json()
    expect(first).toMatchObject({ passCount: 1, source: 'real' })
    expect(first).not.toHaveProperty('avatarUrl')
    expect(first.fetchedAt).toBeTruthy()
    expect(Date.parse(first.startedAt)).toBeLessThanOrEqual(Date.parse(first.fetchedAt))
    expect(await (await handler(request())).json()).toMatchObject({ passCount: 1, source: 'cache', fetchedAt: first.fetchedAt })
    rawPasses = []
    expect(await (await handler(request(true))).json()).toMatchObject({ passCount: 0, source: 'real' })
    expect(fetcher.mock.calls.filter((call) => String(call[0]).includes('/passes'))).toHaveLength(2)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('keeps app authentication and configuration checks ahead of cache access', async () => {
    const handler = (await import('./pack-ratings')).default
    vi.stubEnv('BASIC_AUTH_PASSWORD', 'private-app-password')
    expect((await handler(request())).status).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
    vi.stubEnv('BASIC_AUTH_PASSWORD', '')
    vi.stubEnv('REAL_IMPORT_ENABLED', 'false')
    expect((await handler(request())).status).toBe(503)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not cache malformed upstream success as an empty collection', async () => {
    const handler = (await import('./pack-ratings')).default
    malformed = true
    const failed = await handler(request())
    expect(failed.status).toBe(502)
    malformed = false
    expect(await (await handler(request())).json()).toMatchObject({ passCount: 1, source: 'real' })
  })
})

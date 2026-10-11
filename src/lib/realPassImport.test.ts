import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyData } from './storage'
import { fetchRealUserPasses, REAL_PASSES_ENDPOINT } from './realPassImport'
import { REAL_EARNINGS_ENDPOINT } from './realEarningsImport'
import { importFromUsername } from './usernameImport'

const routePayload = {
  ok: true,
  source: 'real_api',
  username: 'gordon',
  playerPasses: [
    {
      entityId: 551,
      season: 2025,
      sportRaw: 'fc',
      pair: '551:2025:fc',
      passKind: 'player',
      rarityLabel: 'Iconic 1',
      playerName: 'Anthony Gordon',
      seasonLabel: '2025-26',
    },
    {
      entityId: 552,
      season: 2025,
      sportRaw: 'fc',
      pair: '552:2025:fc',
      passKind: 'player',
      rarityLabel: 'General',
      playerName: 'Someone Else',
      seasonLabel: '2025-26',
    },
  ],
  teamPasses: [
    {
      entityId: 900,
      season: 2026,
      sportRaw: 'nba',
      pair: '900:2026:nba',
      passKind: 'team',
      rarityLabel: 'Legendary 2',
      playerName: 'LAL Lakers',
      seasonLabel: '2025-26',
    },
  ],
  rarities: {
    '551-2025-fc': ['Iconic 1'],
    '552-2025-fc': ['General'],
    '900-2026-nba': ['Legendary 2'],
  },
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): {
  calls: string[]
} {
  const calls: string[] = []
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    return Promise.resolve(handler(url, init)).then((response) => response.clone())
  }) as typeof fetch
  return { calls }
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.unstubAllEnvs()
})

describe('fetchRealUserPasses', () => {
  it('posts the username to the server route and returns the pass lists', async () => {
    const { calls } = mockFetch(() => Response.json(routePayload, { status: 200 }))

    const result = await fetchRealUserPasses('@gordon')

    expect(calls).toEqual([REAL_PASSES_ENDPOINT])
    expect(result.playerPasses).toHaveLength(2)
    expect(result.teamPasses).toHaveLength(1)
    expect(result.rarities['551-2025-fc']).toEqual(['Iconic 1'])
  })

  it('surfaces the route error message', async () => {
    mockFetch(() =>
      Response.json(
        { error: 'Real rejected the import session.', code: 'real_session_expired' },
        { status: 502 },
      ),
    )

    await expect(fetchRealUserPasses('gordon')).rejects.toThrow(/rejected the import session/)
  })
})

describe('importFromUsername with the Real provider', () => {
  it('imports cards first, then backfills daily RAX through the earnings route', async () => {
    vi.stubEnv('VITE_REAL_IMPORT_ENABLED', 'true')
    const { calls } = mockFetch((url, init) => {
      if (url === REAL_PASSES_ENDPOINT) {
        return Response.json(routePayload, { status: 200 })
      }
      if (url === '/api/catalog/avatars') {
        return Response.json({ avatars: [], storageConfigured: true }, { status: 200 })
      }
      if (url === REAL_EARNINGS_ENDPOINT) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          passes: Array<{ externalKey: string; name: string }>
        }
        return Response.json({
          ok: true,
          stats: {
            requested: body.passes.length,
            cacheHits: 0,
            fetched: body.passes.length,
            upstreamRequests: body.passes.length,
            passesWithoutEarnings: body.passes.length,
            rowsWritten: 0,
            passesWritten: body.passes.length,
            cacheConfigured: false,
          },
          failures: [],
          passes: body.passes.map((pass) => ({
            externalKey: pass.externalKey,
            source: 'real',
            rows: [],
            cachedRowCount: 0,
            newRowCount: 0,
          })),
        })
      }
      return Response.json({ error: `unexpected fetch ${url}` }, { status: 500 })
    })

    const { data, result } = await importFromUsername(createEmptyData(), 'gordon')

    expect(calls[0]).toBe(REAL_PASSES_ENDPOINT)
    expect(calls.slice(1)).toEqual(['/api/catalog/avatars', REAL_EARNINGS_ENDPOINT])
    expect(result.passesFetched).toBe(2)
    expect(result.passesSkipped).toBe(1)
    expect(result.rowsImported).toBe(0)
    expect(result.ownedPasses).toHaveLength(3)
    expect(data.cards.map((card) => card.name).sort()).toEqual(['Anthony Gordon', 'LAL Lakers'])
    expect(data.cards.find((card) => card.name === 'Anthony Gordon')).toMatchObject({
      sport: 'FC',
      season: '2025-26',
      rarityLabel: 'Iconic 1',
      passKind: 'player',
      externalKey: '551|2025|FC',
    })
    expect(data.cards.find((card) => card.name === 'LAL Lakers')?.passKind).toBe('team')
    expect(result.passesWithNoEarnings).toHaveLength(2)
    expect(result.dailyRaxBackfill).toMatchObject({
      passes: 2,
      fetched: 2,
      rowsReturned: 0,
    })
    expect(result.errors.some((error) => error.includes('no daily RAX'))).toBe(true)
  })
})

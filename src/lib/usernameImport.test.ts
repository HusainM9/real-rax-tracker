import { describe, expect, it } from 'vitest'
import { createEmptyData } from './storage'
import { getFailedPlayerPasses, importFromAdminOwnership, importFromUsername } from './usernameImport'

const samplePassesResponse = {
  playerPairs: ['100:2026:nba', '200:2026:nfl'],
  teamPairs: ['300:2023:ufc', '400:2026:nba'],
  user: { userId: 'abc', avatarKey: '1' },
  rarities: {
    '100-2026-nba': ['Legendary 1'],
    '200-2026-nfl': ['General'],
    '300-2023-ufc': ['Mystic 2'],
    '400-2026-nba': ['Common'],
  },
  passSnapshots: [
    {
      entityId: 100,
      season: 2026,
      sport: 'nba',
      label: 'Test Player',
      rarityLabel: 'Legendary 1',
    },
    {
      entityId: 200,
      season: 2026,
      sport: 'nfl',
      label: 'Other Player',
      rarityLabel: 'General',
    },
    {
      entityId: 300,
      season: 2023,
      sport: 'ufc',
      label: "Sean O'Malley",
      rarityLabel: 'Mystic 2',
    },
    {
      entityId: 400,
      season: 2026,
      sport: 'nba',
      label: 'LAL Lakers',
      rarityLabel: 'Common',
    },
  ],
}

const otdPassRows = {
  playerRows: [
    {
      entityId: 100,
      season: 2026,
      sport: 'nba',
      seasonLabel: '2025-26',
      playerName: 'Test Player',
    },
    {
      entityId: 200,
      season: 2026,
      sport: 'nfl',
      seasonLabel: '2025-26',
      playerName: 'Other Player',
    },
    {
      entityId: 300,
      season: 2023,
      sport: 'ufc',
      seasonLabel: '2023',
      playerName: "Sean O'Malley",
    },
  ],
  teamRows: [
    {
      entityId: 400,
      season: 2026,
      sport: 'nba',
      seasonLabel: '2025-26',
      teamName: 'LAL Lakers',
    },
  ],
}

const dailyRowsByEntity: Record<number, { rows: Array<{ day: string; earnings: number }> }> = {
  100: { rows: [{ day: '2025-08-22', earnings: 26 }] },
  200: { rows: [{ day: '2025-09-13', earnings: 14 }] },
  300: { rows: [{ day: '2017-07-19', earnings: 101 }] },
  400: { rows: [{ day: '2025-10-12', earnings: 25 }] },
}

function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input)
  const body = init?.body ? JSON.parse(String(init.body)) : {}

  if (url.includes('resolve-listing')) {
    return Promise.resolve(
      new Response(JSON.stringify(samplePassesResponse), { status: 200 }),
    )
  }

  if (url.includes('market-data') && body.action === 'get_user_otd_data') {
    return Promise.resolve(new Response(JSON.stringify(otdPassRows), { status: 200 }))
  }

  if (
    url.includes('market-data') &&
    (body.action === 'get_daily_earnings' || body.action === 'get_team_daily_earnings')
  ) {
    const entityId = body.payload.entityId as number
    return Promise.resolve(
      new Response(JSON.stringify(dailyRowsByEntity[entityId] ?? { rows: [] }), { status: 200 }),
    )
  }

  return Promise.resolve(new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 }))
}

describe('importFromUsername', () => {
  it('creates cards and OTD-adjusted performances from mocked API responses', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mockFetch as typeof fetch

    try {
      const { data, result } = await importFromUsername(createEmptyData(), 'testuser')

      expect(result.cardsCreated).toBe(2)
      expect(result.rowsImported).toBe(2)
      expect(result.passesFetched).toBe(2)
      expect(result.passesSkipped).toBe(2)
      expect(result.cachedPlayerPasses).toBe(0)
      expect(result.ownedPasses).toHaveLength(4)
      expect(data.cards).toHaveLength(2)
      expect(data.performances).toHaveLength(2)
      expect(data.cachedPlayerEarnings ?? []).toHaveLength(0)
      expect(data.cards[0]?.externalKey).toBe('100|2026|NBA')
      expect(data.performances[0]?.claimDay).toBe('2025-08-22')
      expect(data.performances[0]?.raxEarned).toBe(650)
      const ufcCard = data.cards.find((card) => card.sport === 'UFC')
      expect(ufcCard?.name).toBe("Sean O'Malley")
      const ufcPerf = data.performances.find((perf) => perf.cardId === ufcCard?.id)
      expect(ufcPerf?.raxEarned).toBe(1030)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('skips passes below Legendary', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mockFetch as typeof fetch

    try {
      const { data, result } = await importFromUsername(createEmptyData(), 'testuser')

      expect(result.passesFetched).toBe(2)
      expect(result.passesSkipped).toBe(2)
      expect(data.cards.every((card) => card.name === 'Test Player' || card.name === "Sean O'Malley")).toBe(
        true,
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('records passes with no daily earnings', async () => {
    const originalFetch = globalThis.fetch
    const noEarningsFetch: typeof fetch = (input, init) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (url.startsWith('/api/catalog/import?')) {
        return Promise.resolve(
          new Response(JSON.stringify({ storageConfigured: true, profile: null }), { status: 200 }),
        )
      }
      if (
        url.includes('market-data') &&
        (body.action === 'get_daily_earnings' || body.action === 'get_team_daily_earnings') &&
        body.payload.entityId === 100
      ) {
        return Promise.resolve(new Response(JSON.stringify({ rows: [] }), { status: 200 }))
      }
      return mockFetch(input, init)
    }
    globalThis.fetch = noEarningsFetch

    try {
      const { data, result } = await importFromUsername(createEmptyData(), 'testuser')

      expect(result.passesWithNoEarnings).toEqual([
        expect.objectContaining({
          name: 'Test Player',
          sport: 'NBA',
          externalKey: '100|2026|NBA',
          passKind: 'player',
        }),
      ])
      expect(result.errors.some((error) => error.includes('Meowbot or shared catalog'))).toBe(true)
      expect(getFailedPlayerPasses(result)).toEqual([
        expect.objectContaining({
          name: 'Test Player',
          sport: 'NBA',
          reason: 'no_earnings',
        }),
      ])
      expect(data.cards.find((card) => card.externalKey === '100|2026|NBA')).toBeDefined()
      expect(data.performances.filter((perf) => perf.cardId === data.cards[0]?.id)).toHaveLength(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('falls back to shared catalog when Meowbot returns no earnings', async () => {
    const originalFetch = globalThis.fetch
    const catalogFallbackFetch: typeof fetch = (input, init) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (url.startsWith('/api/catalog/import?externalKey=100%7C2026%7CNBA')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              storageConfigured: true,
              profile: {
                externalKey: '100|2026|NBA',
                entityId: 100,
                passKind: 'player',
                sport: 'NBA',
                seasonYear: 2026,
                seasonLabel: '2025-26',
                name: 'Test Player',
                rarityLabel: 'Legendary 1',
                cachedAt: '2026-06-11T00:00:00.000Z',
                rowCount: 1,
                totalBaseRax: 26,
                rows: [{ claimDay: '2025-08-22', baseRaxEarned: 26 }],
              },
            }),
            { status: 200 },
          ),
        )
      }
      if (
        url.includes('market-data') &&
        (body.action === 'get_daily_earnings' || body.action === 'get_team_daily_earnings') &&
        body.payload.entityId === 100
      ) {
        return Promise.resolve(new Response(JSON.stringify({ rows: [] }), { status: 200 }))
      }
      return mockFetch(input, init)
    }
    globalThis.fetch = catalogFallbackFetch

    try {
      const { data, result } = await importFromUsername(createEmptyData(), 'testuser')

      expect(result.passesWithNoEarnings).toHaveLength(0)
      expect(result.rowsImported).toBe(2)
      const testPlayerPerf = data.performances.find(
        (performance) => performance.claimDay === '2025-08-22' && performance.raxEarned === 650,
      )
      expect(testPlayerPerf).toBeDefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('replaces performances for imported cards on re-import', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mockFetch as typeof fetch

    try {
      const first = await importFromUsername(createEmptyData(), 'testuser')
      const second = await importFromUsername(first.data, 'testuser')

      expect(second.result.cardsCreated).toBe(0)
      expect(second.result.cardsUpdated).toBe(2)
      expect(second.result.rowsImported).toBe(2)
      expect(second.result.skipped).toBe(0)
      expect(second.data.cards).toHaveLength(2)
      expect(second.data.performances).toHaveLength(2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('forces calendar-year season labels for MLB imports', async () => {
    const originalFetch = globalThis.fetch
    const mlbFetch: typeof fetch = (input, init) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) : {}

      if (url.includes('resolve-listing')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              playerPairs: ['555:2026:mlb'],
              teamPairs: [],
              user: { userId: 'abc', avatarKey: '1' },
              rarities: { '555-2026-mlb': ['Legendary 1'] },
              passSnapshots: [
                {
                  entityId: 555,
                  season: 2026,
                  sport: 'mlb',
                  label: 'MLB Test',
                  rarityLabel: 'Legendary 1',
                },
              ],
            }),
            { status: 200 },
          ),
        )
      }

      if (url.includes('market-data') && body.action === 'get_user_otd_data') {
        // Upstream occasionally reports split-year for MLB; import should normalize to calendar year.
        return Promise.resolve(
          new Response(
            JSON.stringify({
              playerRows: [
                {
                  entityId: 555,
                  season: 2026,
                  sport: 'mlb',
                  seasonLabel: '2025-26',
                  playerName: 'MLB Test',
                },
              ],
              teamRows: [],
            }),
            { status: 200 },
          ),
        )
      }

      if (url.includes('market-data') && body.action === 'get_daily_earnings') {
        return Promise.resolve(
          new Response(JSON.stringify({ rows: [{ day: '2026-04-15', earnings: 12 }] }), {
            status: 200,
          }),
        )
      }

      return Promise.resolve(new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 }))
    }
    globalThis.fetch = mlbFetch

    try {
      const { data } = await importFromUsername(createEmptyData(), 'testuser')
      expect(data.cards).toHaveLength(1)
      expect(data.cards[0]?.sport).toBe('MLB')
      expect(data.cards[0]?.season).toBe('2026')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('forces calendar-year season labels for MLB admin snapshot imports', async () => {
    const originalFetch = globalThis.fetch
    const snapshotFetch: typeof fetch = (input) => {
      const url = String(input)
      if (url === '/api/import/ownership') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              source: 'admin_ownership_snapshot',
              username: 'testuser',
              passes: [
                {
                  name: 'Shohei Ohtani',
                  sport: 'MLB',
                  season: '2025-26',
                  seasonYear: 2026,
                  entityId: 999,
                  rarityLabel: 'Legendary 1',
                  externalKey: '999|2026|MLB',
                  passKind: 'player',
                },
              ],
            }),
            { status: 200 },
          ),
        )
      }
      if (url.startsWith('/api/catalog/import?')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              storageConfigured: true,
              profile: {
                externalKey: '999|2026|MLB',
                entityId: 999,
                passKind: 'player',
                sport: 'MLB',
                seasonYear: 2026,
                seasonLabel: '2026',
                name: 'Shohei Ohtani',
                rarityLabel: 'Legendary 1',
                cachedAt: '2026-06-11T00:00:00.000Z',
                rowCount: 1,
                totalBaseRax: 10,
                rows: [{ claimDay: '2026-04-01', baseRaxEarned: 10 }],
              },
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 }))
    }
    globalThis.fetch = snapshotFetch

    try {
      const { data, result } = await importFromAdminOwnership(createEmptyData(), 'testuser')
      expect(result.passesFetched).toBe(1)
      expect(result.rowsImported).toBe(1)
      expect(data.cards).toHaveLength(1)
      expect(data.cards[0]?.name).toContain('Ohtani')
      expect(data.cards[0]?.sport).toBe('MLB')
      expect(data.cards[0]?.season).toBe('2026')
      expect(data.cards[0]?.rarityLabel).toBe('Legendary 1')
      expect(data.performances).toHaveLength(1)
      expect(data.performances[0]?.baseRaxEarned).toBe(10)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

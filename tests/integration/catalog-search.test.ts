import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { searchCatalogPasses } from '../../lib/meowbotCatalogStore'

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://catalog.offline.invalid')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'offline-catalog-fixture')
  vi.stubEnv('KV_REST_API_URL', 'https://storage.offline.invalid')
  vi.stubEnv('KV_REST_API_TOKEN', 'offline-catalog-fixture')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

function pass(name: string, entityId: number, seasonYear = 2026, sport = 'FC') {
  return {
    external_key: `${entityId}|${seasonYear}|${sport}`, entity_id: entityId,
    pass_kind: 'player' as const, sport, season_year: seasonYear,
    season_label: String(seasonYear), name, has_earnings: true,
    total_base_rax: 120, cached_at: '2026-11-09T00:00:00Z',
    meowbot_daily_earnings: [{ count: 3 }],
  }
}
type Pass = ReturnType<typeof pass>

function ilike(value: string, pattern: string): boolean {
  let expression = ''
  let escaped = false
  for (const character of pattern) {
    if (!escaped && character === '\\') { escaped = true; continue }
    expression += !escaped && (character === '*' || character === '%') ? '.*'
      : !escaped && character === '_' ? '.' : character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    escaped = false
  }
  return new RegExp(`^${expression}$`, 'iu').test(value)
}

// Simulate filtering, ordering and LIMIT at the external database boundary.
// The store, identity handling and guarded transport all run unchanged.
function catalog(rows: Pass[], failAt?: number) {
  const requests: URLSearchParams[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.origin === 'https://storage.offline.invalid' && url.pathname === '/') {
      const command = JSON.parse(String(init?.body))
      if (command[0] === 'eval' && command[3] === 'rax:operational-errors:v1') return Response.json({ result: 1 })
      throw new Error('Unexpected offline storage command')
    }
    if (url.origin !== 'https://catalog.offline.invalid' || url.pathname !== '/rest/v1/meowbot_passes') {
      throw new Error('Unexpected offline destination')
    }
    expect(init?.redirect).toBe('manual')
    expect(init?.method ?? 'GET').toBe('GET')
    const params = url.searchParams
    requests.push(params)
    if (requests.length === failAt) return Response.json({}, { status: 503 })
    let selected = rows.filter(row => {
      const name = params.get('name')
      if (name?.startsWith('ilike.') && !ilike(row.name, name.slice(6))) return false
      if (name?.startsWith('not.ilike.') && ilike(row.name, name.slice(10))) return false
      const or = params.get('or')
      if (!or) return true
      return or.slice(1, -1).split(',').some(filter => {
        const [field, operator, ...pattern] = filter.split('.')
        if (!['name', 'sport', 'season_label'].includes(field) || operator !== 'ilike') {
          throw new Error('Unexpected offline filter')
        }
        return ilike(String(row[field as keyof Pass]), pattern.join('.'))
      })
    })
    expect(params.get('order')?.startsWith('name.asc')).toBe(true)
    selected = selected.sort((a, b) => a.name.localeCompare(b.name) || a.external_key.localeCompare(b.external_key))
    return Response.json(selected.slice(0, Number(params.get('limit'))))
  })
  return requests
}

it.each([
  { query: '  rOdRi  ', name: 'Rodri', partial: 'Adrian Rodriguez' },
  { query: 'ali', name: 'Ali', partial: 'Aaron Alisson' },
  { query: 'r_d%i', name: 'R_d%i', partial: 'Adrian Rodriguez' },
])('keeps exact $name seasons ahead of more than a page of partial matches', async ({ query, name, partial }) => {
  const broad = Array.from({ length: 80 }, (_, index) => pass(`${partial} ${index}`, index + 10))
  const requests = catalog([...broad, pass(name, 1), pass(name, 1, 2025)])

  const { results } = await searchCatalogPasses({ query })

  expect(results.slice(0, 2).map(result => [result.name, result.seasonYear])).toEqual([[name, 2025], [name, 2026]])
  expect(results).toHaveLength(24)
  expect(new Set(results.map(result => result.externalKey)).size).toBe(24)
  expect(results[2].name).toBe(`${partial} 0`)
  expect(results[0]).toMatchObject({ rowCount: 3, totalBaseRax: 120, sport: 'FC' })
  expect(requests).toHaveLength(2)
  expect(requests.map(params => Number(params.get('limit')))).toEqual([24, 22])
})

it('stops querying when exact matches fill the requested limit', async () => {
  const requests = catalog([pass('Rodri', 1, 2024), pass('Rodri', 1, 2025), pass('Rodri', 1), pass('Aaron Rodriguez', 2)])

  const { results } = await searchCatalogPasses({ query: 'rodri', limit: 2 })

  expect(results.map(result => result.name)).toEqual(['Rodri', 'Rodri'])
  expect(requests).toHaveLength(1)
})

it.each([
  { query: 'driguez', want: ['Adrian Rodriguez'] },
  { query: 'nhl', want: ['Hockey player'] },
  { query: '2025', want: ['Previous season player'] },
])('preserves broader matching for $query when no name is exact', async ({ query, want }) => {
  catalog([pass('Adrian Rodriguez', 1), pass('Hockey player', 2, 2027, 'NHL'), pass('Previous season player', 3, 2025)])

  const { results, storageConfigured } = await searchCatalogPasses({ query })

  expect(results.map(result => result.name)).toEqual(want)
  expect(storageConfigured).toBe(true)
})

it.each([1, 2])('stops a failure in catalog read %i without fallback or partial success and permits a later search', async failAt => {
  const requests = catalog([pass('Rodri', 1), pass('Adrian Rodriguez', 2)], failAt)

  await expect(searchCatalogPasses({ query: 'rodri' })).rejects.toMatchObject({ status: 503 })
  expect(requests).toHaveLength(failAt)

  const { results } = await searchCatalogPasses({ query: 'rodri' })
  expect(results.map(result => result.name)).toEqual(['Rodri', 'Adrian Rodriguez'])
  expect(requests).toHaveLength(failAt + 2)
})

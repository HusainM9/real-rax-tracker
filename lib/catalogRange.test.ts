import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browseCatalogPasses } from './meowbotCatalogStore'

const pass = { external_key: '1|2026|NBA', entity_id: 1, pass_kind: 'player', sport: 'NBA', season_year: 2026, season_label: '2025-26', name: 'Player', has_earnings: true, total_base_rax: 10, cached_at: '2026-10-30' }
const options = { startDate: '2026-01-01', endDate: '2026-01-31', sports: ['NBA'], seasonYears: [2026], passKind: 'player' as const, query: 'Player', limit: 20, offset: 0 }
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://example.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key')
  vi.stubEnv('CATALOG_RANGE_RPC_ENABLED', '')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('catalog range completeness', () => {
  it('marks a scan ending with a full 80th raw page as incomplete', async () => {
    const rows = Array.from({ length: 1000 }, () => ({ external_key: pass.external_key, claim_day: '2026-01-01', base_rax_earned: 1, meowbot_passes: pass }))
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(rows)))
    const result = await browseCatalogPasses(options)
    expect(result.incomplete).toBe(true)
    expect(result.results[0]?.rangeBaseRax).toBe(80_000)
  })

  it('uses aggregate totals beyond the raw cap and preserves totals on empty offset pages', async () => {
    vi.stubEnv('CATALOG_RANGE_RPC_ENABLED', '1')
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ p_sports: ['NBA'], p_season_years: [2026], p_query: 'Player', p_pass_kind: 'player' })
      return Response.json({ rows: body.p_offset ? [] : [{ ...pass, range_base_rax: 100_001, row_count: 100_001 }], total: 1 })
    }))
    const result = await browseCatalogPasses(options)
    expect(result.results[0]?.rangeBaseRax).toBe(100_001)
    expect(result.incomplete).not.toBe(true)
    expect(await browseCatalogPasses({ ...options, offset: 20 })).toMatchObject({ results: [], total: 1 })
  })

  it('falls back only for a missing RPC, preserving raw-query filters and stable order', async () => {
    vi.stubEnv('CATALOG_RANGE_RPC_ENABLED', '1')
    let rpcRequests = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input)
      if (url.pathname.includes('/rpc/')) { rpcRequests++; return Response.json({ code: 'PGRST202', message: 'function not found' }, { status: 404 }) }
      expect(url.searchParams.get('meowbot_passes.sport')).toBe('eq.NBA')
      expect(url.searchParams.get('meowbot_passes.season_year')).toBe('eq.2026')
      expect(url.searchParams.get('meowbot_passes.pass_kind')).toBe('eq.player')
      expect(url.searchParams.get('meowbot_passes.name')).toBe('ilike.*Player*')
      return Response.json([
        { external_key: '2', claim_day: '2026-01-01', base_rax_earned: 5, meowbot_passes: { ...pass, external_key: '2', name: 'Zed' } },
        { external_key: '1', claim_day: '2026-01-01', base_rax_earned: 5, meowbot_passes: { ...pass, external_key: '1', name: 'Amy' } },
      ])
    }))
    expect((await browseCatalogPasses(options)).results.map((row) => row.name)).toEqual(['Amy', 'Zed'])
    expect(rpcRequests).toBe(1)
  })

  it('does not silently turn aggregate errors into empty or partial success', async () => {
    vi.stubEnv('CATALOG_RANGE_RPC_ENABLED', '1')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: '42501', message: 'permission denied' }, { status: 403 })))
    await expect(browseCatalogPasses(options)).rejects.toThrow(/403|permission denied/)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCatalogImportProfilesBulk } from './meowbotCatalogStore'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('catalog daily row paging', () => {
  it.each([12, 1500])('loads all %i rows with count attached to the first page', async (count) => {
    vi.stubEnv('SUPABASE_URL', 'https://example.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key')
    const key = '1|2025|UFC'
    const dailyRows = Array.from({ length: count }, (_, index) => ({
      external_key: key,
      claim_day: new Date(Date.UTC(2021, 0, 1 + index)).toISOString().slice(0, 10),
      base_rax_earned: 1,
      player_box_score_id: null,
    }))
    const dailyRequests: Array<{ offset: number; prefer: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/meowbot_passes')) {
        return Response.json([{
          external_key: key, entity_id: 1, pass_kind: 'player', sport: 'UFC',
          season_year: 2025, season_label: '2025', name: 'Fighter', has_earnings: true,
          total_base_rax: count, cached_at: '2026-01-01T00:00:00Z',
        }])
      }
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const prefer = new Headers(init?.headers).get('prefer') ?? ''
      dailyRequests.push({ offset, prefer })
      return Response.json(dailyRows.slice(offset, offset + 1000), {
        headers: offset === 0 ? { 'content-range': `0-${Math.min(count, 1000) - 1}/${count}` } : {},
      })
    }))

    const result = await fetchCatalogImportProfilesBulk([key])
    expect(result.profiles[0]?.storedRowCount).toBe(count)
    expect(dailyRequests.map((request) => request.offset)).toEqual(count > 1000 ? [0, 1000] : [0])
    expect(dailyRequests[0]?.prefer).toBe('count=exact')
  })

  it('falls back to a separate count when the server omits the count header', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key')
    const key = '1|2025|UFC'
    let countRequests = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/meowbot_passes')) {
        return Response.json([{
          external_key: key, entity_id: 1, pass_kind: 'player', sport: 'UFC',
          season_year: 2025, season_label: '2025', name: 'Fighter', has_earnings: true,
          total_base_rax: 1, cached_at: '2026-01-01T00:00:00Z',
        }])
      }
      if (url.searchParams.get('limit') === '1') {
        countRequests += 1
        return Response.json([], { headers: { 'content-range': '0-0/1' } })
      }
      return Response.json([{ external_key: key, claim_day: '2025-01-01', base_rax_earned: 1 }])
    }))

    const result = await fetchCatalogImportProfilesBulk([key])
    expect(result.profiles[0]?.storedRowCount).toBe(1)
    expect(countRequests).toBe(1)
  })
})

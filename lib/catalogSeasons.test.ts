import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listCatalogSeasonYears } from './meowbotCatalogStore'

type Row = { season_year: number; season_label: string }
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://catalog.example.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-token')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

function catalog(rows: Row[]) {
  const sorted = [...rows].sort((a, b) => b.season_year - a.season_year || b.season_label.localeCompare(a.season_label))
  const calls: URL[] = []
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input)
    calls.push(url)
    if (calls.length > 30) throw new Error('Unexpected repeated catalog reads')
    let matching = sorted
    const seek = url.searchParams.get('or')
    if (seek) {
      const match = seek.match(/^\(season_year\.lt\.(\d+),and\(season_year\.eq\.\1,season_label\.lt\."([^"]*)"\)\)$/)
      if (!match) throw new Error('Invalid season-pair seek filter')
      const year = Number(match[1]); const label = match[2]
      matching = matching.filter(row => row.season_year < year || row.season_year === year && row.season_label < label)
    }
    const offset = Number(url.searchParams.get('offset') ?? 0)
    return Response.json(matching.slice(offset, offset + Number(url.searchParams.get('limit'))))
  })
  return calls
}

describe('catalog season discovery', () => {
  it('skips thousands of duplicate player rows without losing different labels stored on the same year', async () => {
    const calls = catalog([
      ...Array.from({ length: 1200 }, () => ({ season_year: 2026, season_label: '2026-27' })),
      ...Array.from({ length: 1200 }, () => ({ season_year: 2026, season_label: '2025-26' })),
      ...Array.from({ length: 1200 }, () => ({ season_year: 2024, season_label: '2023-24' })),
    ])
    expect(await listCatalogSeasonYears({ sport: 'CFB' })).toEqual({ storageConfigured: true, seasonYears: [
      { seasonYear: 2026, seasonLabel: '2026-27' },
      { seasonYear: 2025, seasonLabel: '2025-26' },
      { seasonYear: 2023, seasonLabel: '2023-24' },
    ] })
    expect(calls).toHaveLength(4)
    expect(calls.every(url => url.pathname === '/rest/v1/meowbot_passes' &&
      url.searchParams.get('sport') === 'eq.CFB' && url.searchParams.get('pass_kind') === 'eq.player')).toBe(true)
  })

  it('still loads a small catalog in one read and preserves blank-label normalization', async () => {
    const calls = catalog([{ season_year: 2026, season_label: '' }, { season_year: 2025, season_label: '2025-26' }])
    expect(await listCatalogSeasonYears({ sport: 'CFB', passKind: 'team' })).toMatchObject({ seasonYears: [
      { seasonYear: 2026, seasonLabel: '2026-27' }, { seasonYear: 2025, seasonLabel: '2025-26' },
    ] })
    expect(calls).toHaveLength(1)
    expect(calls[0].searchParams.get('pass_kind')).toBe('eq.team')
  })

  it('stops a non-advancing page instead of hanging the season picker', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      if (++calls > 3) throw new Error('Unexpected fourth page')
      return Response.json(Array.from({ length: 200 }, () => ({ season_year: 2026, season_label: '2026-27' })))
    })
    await expect(listCatalogSeasonYears({ sport: 'CFB' })).rejects.toThrow(/season.*advance/i)
    expect(calls).toBe(2)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { RealApiError, type RealPassEarnings, type RealShopEarningsTotalPage } from './realApi'
import {
  DEFAULT_SHOP_CRAWL_MAX_PAGES,
  LIVE_SHOP_CRAWL_SPORT_SLUGS,
  MAX_SHOP_CRAWL_MAX_PAGES,
  SHOP_EARNINGS_PAGE_SIZE,
  buildShopCrawlJobs,
  crawlShopEarningsTotalChunk,
  mapShopEarningsItemToCatalogPass,
  mapShopItemEarningsToCatalog,
  resolveShopCrawlMaxPages,
  resolveShopCrawlSports,
  toRealShopSportSlug,
  type ShopCrawlJob,
} from './realShopEarningsCrawl'

describe('shop crawl defaults', () => {
  it('defaults to one page per chunk so the first HTTP response returns sooner', () => {
    expect(DEFAULT_SHOP_CRAWL_MAX_PAGES).toBe(1)
    expect(MAX_SHOP_CRAWL_MAX_PAGES).toBe(5)
    expect(resolveShopCrawlMaxPages({})).toBe(1)
  })
})

const job: ShopCrawlJob = { realSport: 'ncaam', season: 2026, entityType: 'player' }

describe('toRealShopSportSlug', () => {
  it('maps app sports onto Real path slugs', () => {
    expect(toRealShopSportSlug('CBB')).toBe('ncaam')
    expect(toRealShopSportSlug('cbb')).toBe('ncaam')
    expect(toRealShopSportSlug('FC')).toBe('soccer')
    expect(toRealShopSportSlug('soccer')).toBe('soccer')
    expect(toRealShopSportSlug('CFB')).toBe('ncaaf')
    expect(toRealShopSportSlug('NBA')).toBe('nba')
    expect(toRealShopSportSlug('UFC')).toBe('ufc')
  })
})

describe('resolveShopCrawlSports', () => {
  it('defaults to live sports without UFC', () => {
    expect(resolveShopCrawlSports({})).toEqual([...LIVE_SHOP_CRAWL_SPORT_SLUGS])
    expect(resolveShopCrawlSports({ includeUfc: true })).toContain('ufc')
  })

  it('keeps UFC out unless toggled even when sports are explicit', () => {
    expect(resolveShopCrawlSports({ sports: ['nba', 'ufc'], includeUfc: false })).toEqual(['nba'])
    expect(resolveShopCrawlSports({ sports: ['nba'], includeUfc: true })).toEqual(['nba', 'ufc'])
  })

  it('keeps UFC-only requests from expanding to all live sports', () => {
    expect(resolveShopCrawlSports({ sports: ['ufc'], includeUfc: true })).toEqual(['ufc'])
    expect(resolveShopCrawlSports({ sports: ['ufc'], includeUfc: false })).toEqual(['ufc'])
  })
})

describe('mapShopEarningsItemToCatalogPass', () => {
  it('maps value → total_base_rax and has_earnings', () => {
    const pass = mapShopEarningsItemToCatalogPass(
      {
        id: 42,
        value: '128.5',
        entityType: 'player',
        sport: 'ncaam',
        label: 'Test Player',
      },
      job,
    )
    expect(pass).toMatchObject({
      entityId: 42,
      passKind: 'player',
      sport: 'CBB',
      seasonYear: 2026,
      seasonLabel: '2025-26',
      name: 'Test Player',
      totalBaseRax: 128.5,
      hasEarnings: true,
      externalKey: '42|2026|CBB',
    })
    expect(pass?.rarityLabel).toBeUndefined()
  })

  it('reads entity id from nested entity.id', () => {
    const pass = mapShopEarningsItemToCatalogPass(
      {
        entity: { id: 99 },
        value: '10',
        label: 'Nested',
        sport: 'ncaam',
      } as never,
      job,
    )
    expect(pass?.entityId).toBe(99)
  })

  it('sets has_earnings false when value is zero', () => {
    const pass = mapShopEarningsItemToCatalogPass(
      { id: 7, value: '0', label: 'Zero', sport: 'soccer' },
      { realSport: 'soccer', season: 2025, entityType: 'player' },
    )
    expect(pass).toMatchObject({
      sport: 'FC',
      seasonLabel: '2025-26',
      totalBaseRax: 0,
      hasEarnings: false,
    })
  })

  it('maps UFC shop fighters as player passes on the All-time season', () => {
    const pass = mapShopEarningsItemToCatalogPass(
      {
        id: 1936,
        value: '4281',
        entityType: 'team',
        sport: 'ufc',
        label: 'Max Holloway',
      },
      { realSport: 'ufc', season: 2023, entityType: 'team' },
    )
    expect(pass).toMatchObject({
      entityId: 1936,
      passKind: 'player',
      sport: 'UFC',
      seasonYear: 2023,
      seasonLabel: '2023',
      totalBaseRax: 4281,
      externalKey: '1936|2023|UFC',
    })
  })
})

describe('mapShopItemEarningsToCatalog', () => {
  it('maps shop item + earnings → pass + season-scoped dailies (prefers info.total)', () => {
    const earnings: RealPassEarnings = {
      rows: [
        { day: '2025-11-15', earnings: 10, playerBoxScoreIds: [1] },
        { day: '2025-12-01', earnings: 20, playerBoxScoreIds: [2] },
      ],
      info: { total: 30 },
    }
    const mapped = mapShopItemEarningsToCatalog(
      { id: 42, value: '999', label: 'Test Player', sport: 'ncaam', entityType: 'player' },
      job,
      earnings,
      '2026-01-01T00:00:00.000Z',
    )
    expect(mapped?.pass).toMatchObject({
      externalKey: '42|2026|CBB',
      entityId: 42,
      totalBaseRax: 30,
      hasEarnings: true,
    })
    expect(mapped?.dailyRows).toEqual([
      {
        externalKey: '42|2026|CBB',
        claimDay: '2025-11-15',
        baseRaxEarned: 10,
        playerBoxScoreId: 1,
      },
      {
        externalKey: '42|2026|CBB',
        claimDay: '2025-12-01',
        baseRaxEarned: 20,
        playerBoxScoreId: 2,
      },
    ])
  })

  it('uses filtered row sum when prior-season days are trimmed', () => {
    const nflJob: ShopCrawlJob = { realSport: 'nfl', season: 2023, entityType: 'player' }
    const earnings: RealPassEarnings = {
      rows: [
        { day: '2022-09-15', earnings: 100 }, // prior season for NFL 2023
        { day: '2023-09-15', earnings: 40 },
      ],
      info: { total: 140 },
    }
    const mapped = mapShopItemEarningsToCatalog(
      { id: 1, value: '140', label: 'RB', sport: 'nfl', entityType: 'player' },
      nflJob,
      earnings,
      '2026-01-01T00:00:00.000Z',
    )
    expect(mapped?.dailyRows).toHaveLength(1)
    expect(mapped?.dailyRows[0]?.claimDay).toBe('2023-09-15')
    expect(mapped?.pass.totalBaseRax).toBe(40)
  })
})

describe('crawlShopEarningsTotalChunk pagination + earnings', () => {
  it('stops a job when items are empty and advances the cursor', async () => {
    const fetchPage = vi.fn(async (): Promise<RealShopEarningsTotalPage> => ({ items: [] }))
    const fetchEarnings = vi.fn()
    const savePasses = vi.fn(async () => 0)

    const result = await crawlShopEarningsTotalChunk(
      {
        sports: ['nba'],
        seasons: [2025],
        entityTypes: ['player'],
        maxPages: 3,
        delayMs: 0,
      },
      { fetchPage, fetchEarnings, savePasses, sleep: async () => undefined },
    )

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(fetchEarnings).not.toHaveBeenCalled()
    expect(savePasses).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      done: true,
      pagesFetched: 1,
      upserted: 0,
      earningsFetched: 0,
      nextBefore: 0,
    })
  })

  it('fetches shop page then per-item earnings and replace-upserts dailies', async () => {
    const fetchPage = vi.fn(async (): Promise<RealShopEarningsTotalPage> => ({
      items: [
        { id: 10, value: '50', label: 'A', entityType: 'player', sport: 'nba' },
        { id: 11, value: '40', label: 'B', entityType: 'player', sport: 'nba' },
      ],
    }))
    const fetchEarnings = vi.fn(async (query): Promise<RealPassEarnings> => {
      expect(query).toMatchObject({
        sport: 'nba',
        season: 2025,
        entityType: 'player',
      })
      return {
        rows: [{ day: '2025-01-10', earnings: query.entityId === 10 ? 12 : 8 }],
        info: { total: query.entityId === 10 ? 12 : 8 },
      }
    })
    const savePasses = vi.fn(async (passes) => passes.length)
    const saveDailyEarnings = vi.fn(async (rows, options) => {
      expect(options?.replaceExternalKeys).toEqual(
        expect.arrayContaining(['10|2025|NBA', '11|2025|NBA']),
      )
      return rows.length
    })

    const result = await crawlShopEarningsTotalChunk(
      {
        sports: ['nba'],
        seasons: [2025],
        entityTypes: ['player'],
        maxPages: 1,
        delayMs: 0,
        earningsConcurrency: 1,
      },
      {
        fetchPage,
        fetchEarnings,
        savePasses,
        saveDailyEarnings,
        sleep: async () => undefined,
        now: () => '2026-01-01T00:00:00.000Z',
      },
    )

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(fetchEarnings).toHaveBeenCalledTimes(2)
    expect(fetchEarnings).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 10, sport: 'nba', season: 2025 }),
    )
    expect(fetchEarnings).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 11, sport: 'nba', season: 2025 }),
    )
    expect(savePasses).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ externalKey: '10|2025|NBA', totalBaseRax: 12 }),
        expect.objectContaining({ externalKey: '11|2025|NBA', totalBaseRax: 8 }),
      ]),
    )
    expect(saveDailyEarnings).toHaveBeenCalled()
    expect(result).toMatchObject({
      done: true,
      pagesFetched: 1,
      upserted: 2,
      earningsFetched: 2,
      earningsFailed: 0,
      dailyRowsUpserted: 2,
    })
    expect(result.log.some((event) => event.type === 'chunk_start')).toBe(true)
    expect(result.log.some((event) => event.type === 'page_fetched' && event.itemCount === 2)).toBe(
      true,
    )
    expect(result.log.some((event) => event.type === 'page_summary' && event.ok === 2)).toBe(true)
    expect(result.log.at(-1)).toMatchObject({ type: 'chunk_complete', done: true })
  })

  it('continues the chunk when one entity earnings fetch fails', async () => {
    const fetchPage = vi.fn(async (): Promise<RealShopEarningsTotalPage> => ({
      items: [
        { id: 1, value: '10', label: 'Ok', entityType: 'player', sport: 'nba' },
        { id: 2, value: '20', label: 'Bad', entityType: 'player', sport: 'nba' },
      ],
    }))
    const fetchEarnings = vi.fn(async (query): Promise<RealPassEarnings> => {
      if (query.entityId === 2) {
        throw new RealApiError('rate_limited', 'still limited', 429)
      }
      return {
        rows: [{ day: '2025-01-10', earnings: 10 }],
        info: { total: 10 },
      }
    })
    const savePasses = vi.fn(async (passes) => passes.length)
    const saveDailyEarnings = vi.fn(async (rows, options) => {
      expect(options?.replaceExternalKeys).toEqual(['1|2025|NBA'])
      expect(rows).toHaveLength(1)
      return rows.length
    })

    const result = await crawlShopEarningsTotalChunk(
      {
        sports: ['nba'],
        seasons: [2025],
        entityTypes: ['player'],
        maxPages: 1,
        delayMs: 0,
      },
      {
        fetchPage,
        fetchEarnings,
        savePasses,
        saveDailyEarnings,
        sleep: async () => undefined,
      },
    )

    expect(result.earningsFetched).toBe(1)
    expect(result.earningsFailed).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toContain('/2:')
    expect(result.upserted).toBe(2)
    expect(result.done).toBe(true)
    const failureEvent = result.log.find((event) => event.type === 'earnings_failure')
    expect(failureEvent).toMatchObject({
      entityId: 2,
      name: 'Bad',
      rateLimited: true,
      status: 429,
    })
    expect(failureEvent?.message).toContain('rate limited')
  })

  it('stops after maxPages even when more pages remain', async () => {
    const fetchPage = vi.fn(async (): Promise<RealShopEarningsTotalPage> => ({
      items: Array.from({ length: SHOP_EARNINGS_PAGE_SIZE }, (_, index) => ({
        id: index + 1,
        value: String(100 - index),
        label: `P${index + 1}`,
        entityType: 'player',
        sport: 'nba',
      })),
    }))
    const fetchEarnings = vi.fn(async (): Promise<RealPassEarnings> => ({
      rows: [{ day: '2025-01-10', earnings: 1 }],
      info: { total: 1 },
    }))
    const savePasses = vi.fn(async (passes) => passes.length)
    const saveDailyEarnings = vi.fn(async (rows) => rows.length)

    const result = await crawlShopEarningsTotalChunk(
      {
        sports: ['nba'],
        seasons: [2025],
        entityTypes: ['player'],
        maxPages: 2,
        delayMs: 0,
      },
      {
        fetchPage,
        fetchEarnings,
        savePasses,
        saveDailyEarnings,
        sleep: async () => undefined,
      },
    )

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchEarnings).toHaveBeenCalledTimes(40)
    expect(result.done).toBe(false)
    expect(result.pagesFetched).toBe(2)
    expect(result.upserted).toBe(40)
    expect(result.earningsFetched).toBe(40)
    expect(result.nextBefore).toBe(40)
    expect(result.cursor).toMatchObject({
      jobIndex: 0,
      before: 40,
      sport: 'nba',
      season: 2025,
      entityType: 'player',
    })
  })

  it('returns done with an explanatory log when seasons yield no jobs', async () => {
    const result = await crawlShopEarningsTotalChunk(
      {
        sports: ['ufc'],
        seasons: [],
        includeUfc: true,
        maxPages: 1,
        delayMs: 0,
      },
      {
        fetchPage: async () => ({ items: [] }),
        fetchEarnings: async () => ({ rows: [], info: null }),
        sleep: async () => undefined,
      },
    )
    expect(result.jobsTotal).toBe(0)
    expect(result.done).toBe(true)
    expect(result.failures[0]).toMatch(/No crawl jobs/i)
    expect(result.log.some((event) => event.message.includes('No crawl jobs'))).toBe(true)
  })

  it('skips UFC / missing seasons on 404 without failing the chunk', async () => {
    const fetchPage = vi.fn(async () => {
      throw new RealApiError('not_found', 'missing', 404)
    })

    const result = await crawlShopEarningsTotalChunk(
      {
        sports: ['ufc'],
        seasons: [2023],
        entityTypes: ['team'],
        includeUfc: true,
        maxPages: 2,
        delayMs: 0,
      },
      {
        fetchPage,
        fetchEarnings: async () => ({ rows: [], info: null }),
        savePasses: async () => 0,
        sleep: async () => undefined,
      },
    )

    expect(result.done).toBe(true)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.reason).toContain('404')
    expect(result.log.some((event) => event.type === 'job_skipped')).toBe(true)
  })
})

describe('buildShopCrawlJobs', () => {
  it('expands sports × seasons × entityTypes', () => {
    expect(
      buildShopCrawlJobs({
        sports: ['CBB', 'FC'],
        seasons: [2025, 2026],
        entityTypes: ['player'],
      }),
    ).toEqual([
      { realSport: 'ncaam', season: 2025, entityType: 'player' },
      { realSport: 'ncaam', season: 2026, entityType: 'player' },
      { realSport: 'soccer', season: 2025, entityType: 'player' },
      { realSport: 'soccer', season: 2026, entityType: 'player' },
    ])
  })

  it('forces UFC onto the team shop path even when player is selected', () => {
    expect(
      buildShopCrawlJobs({
        sports: ['ufc'],
        seasons: [2023],
        entityTypes: ['player', 'team'],
        includeUfc: true,
      }),
    ).toEqual([{ realSport: 'ufc', season: 2023, entityType: 'team' }])
  })

  it('builds UFC team jobs when entity toggles are omitted', () => {
    expect(
      buildShopCrawlJobs({
        sports: ['ufc'],
        seasons: [2023],
        entityTypes: [],
        includeUfc: true,
      }),
    ).toEqual([{ realSport: 'ufc', season: 2023, entityType: 'team' }])
  })

  it('still requires entity types for live sports (defaults to both when omitted)', () => {
    expect(
      buildShopCrawlJobs({
        sports: ['nba'],
        seasons: [2025],
      }),
    ).toEqual([
      { realSport: 'nba', season: 2025, entityType: 'player' },
      { realSport: 'nba', season: 2025, entityType: 'team' },
    ])
  })
})

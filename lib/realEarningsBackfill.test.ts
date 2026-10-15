import { describe, expect, it, vi } from 'vitest'
import { RealApiError, type RealPassEarnings } from './realApi'
import { backfillRealPassEarnings, type EarningsBackfillDeps } from './realEarningsBackfill'
import {
  resolveBaseRaxTotal,
  type EarningsBackfillPass,
} from './realEarningsShared'
import type { CatalogImportProfile, CatalogPassInput } from './meowbotCatalogStore'
import { filterDailyRowsToPassSeason } from './seasonClaimWindow'

const samplePass: EarningsBackfillPass = {
  externalKey: '551|2025|FC',
  entityId: 551,
  passKind: 'player',
  sportRaw: 'fc',
  seasonYear: 2025,
  seasonLabel: '2025-26',
  name: 'Anthony Gordon',
  rarityLabel: 'Legendary 1',
}

function earningsResponse(rows: Array<{ day: string; earnings: number }>): RealPassEarnings {
  return {
    rows: rows.map((row) => ({
      day: row.day,
      earnings: row.earnings,
      playerBoxScoreIds: [1001],
    })),
    info: { total: rows.reduce((sum, row) => sum + row.earnings, 0), seasonLabel: '2025-26' },
  }
}

function freshProfile(overrides: Partial<CatalogImportProfile> = {}): CatalogImportProfile {
  const now = new Date().toISOString()
  return {
    externalKey: samplePass.externalKey,
    entityId: samplePass.entityId,
    passKind: samplePass.passKind,
    sport: 'FC',
    seasonYear: samplePass.seasonYear,
    seasonLabel: samplePass.seasonLabel,
    name: samplePass.name,
    rarityLabel: samplePass.rarityLabel,
    hasEarnings: true,
    totalBaseRax: 12,
    rowCount: 1,
    rows: [{ claimDay: '2025-01-10', baseRaxEarned: 12, playerBoxScoreId: 1001 }],
    cachedAt: now,
    sourceUpdatedAt: now,
    ...overrides,
  }
}

describe('backfillRealPassEarnings', () => {
  it('serves fresh catalog rows without calling Real', async () => {
    const fetchEarnings = vi.fn()
    const savePasses = vi.fn()
    const saveDailyEarnings = vi.fn()
    const deps: EarningsBackfillDeps = {
      fetchEarnings,
      loadCachedProfiles: async () => ({
        profiles: [freshProfile()],
        storageConfigured: true,
      }),
      savePasses,
      saveDailyEarnings,
      cacheTtlMs: 60_000,
      now: () => Date.now(),
    }

    const result = await backfillRealPassEarnings([samplePass], deps)

    expect(fetchEarnings).not.toHaveBeenCalled()
    expect(savePasses).not.toHaveBeenCalled()
    expect(saveDailyEarnings).not.toHaveBeenCalled()
    expect(result.stats).toMatchObject({
      requested: 1,
      cacheHits: 1,
      fetched: 0,
      upstreamRequests: 0,
      cacheConfigured: true,
    })
    expect(result.passes[0]).toMatchObject({
      externalKey: samplePass.externalKey,
      source: 'cache',
      rows: [{ claimDay: '2025-01-10', baseRaxEarned: 12, playerBoxScoreId: 1001 }],
    })
  })

  it('keeps completed-season earnings warm longer than active-season earnings', async () => {
    const now = Date.parse('2026-10-15T12:00:00.000Z')
    const historicalPass: EarningsBackfillPass = {
      ...samplePass,
      externalKey: '900|2025|NBA',
      entityId: 900,
      sportRaw: 'nba',
      seasonYear: 2025,
      seasonLabel: '2024-25',
    }
    const cachedAt = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
    const fetchEarnings = vi.fn()

    const result = await backfillRealPassEarnings([historicalPass], {
      fetchEarnings,
      loadCachedProfiles: async () => ({
        profiles: [freshProfile({
          externalKey: historicalPass.externalKey,
          entityId: historicalPass.entityId,
          sport: 'NBA',
          seasonYear: 2025,
          seasonLabel: '2024-25',
          cachedAt,
          sourceUpdatedAt: cachedAt,
        })],
        storageConfigured: true,
      }),
      cacheTtlMs: 60_000,
      now: () => now,
    })

    expect(fetchEarnings).not.toHaveBeenCalled()
    expect(result.stats.cacheHits).toBe(1)
  })

  it('fetches and upserts base RAX on a cache miss (never OTD/atRarity)', async () => {
    const fetchEarnings = vi.fn(async (query) => {
      expect(query).toMatchObject({
        sport: 'soccer',
        season: 2025,
        entityType: 'player',
        entityId: 551,
      })
      expect(query.level).toBeUndefined()
      return earningsResponse([
        { day: '2025-01-10', earnings: 12 },
        { day: '2025-01-17', earnings: 8 },
      ])
    })
    const savePasses = vi.fn(async (passes) => {
      expect(passes).toHaveLength(1)
      expect(passes[0]).toMatchObject({
        externalKey: samplePass.externalKey,
        hasEarnings: true,
        totalBaseRax: 20,
      })
      return 1
    })
    const saveDailyEarnings = vi.fn(async (rows) => {
      expect(rows).toEqual([
        {
          externalKey: samplePass.externalKey,
          claimDay: '2025-01-10',
          baseRaxEarned: 12,
          playerBoxScoreId: 1001,
        },
        {
          externalKey: samplePass.externalKey,
          claimDay: '2025-01-17',
          baseRaxEarned: 8,
          playerBoxScoreId: 1001,
        },
      ])
      return rows.length
    })

    const result = await backfillRealPassEarnings([samplePass], {
      fetchEarnings,
      loadCachedProfiles: async () => ({ profiles: [], storageConfigured: true }),
      savePasses,
      saveDailyEarnings,
      concurrency: 2,
    })

    expect(fetchEarnings).toHaveBeenCalledTimes(1)
    expect(result.stats).toMatchObject({
      requested: 1,
      cacheHits: 0,
      fetched: 1,
      upstreamRequests: 1,
      rowsWritten: 2,
      passesWritten: 1,
    })
    expect(result.passes[0]?.source).toBe('real')
    expect(result.passes[0]?.rows.map((row) => row.baseRaxEarned)).toEqual([12, 8])
  })

  it('records a per-pass failure without aborting the batch', async () => {
    const otherPass: EarningsBackfillPass = {
      ...samplePass,
      externalKey: '900|2026|NBA',
      entityId: 900,
      sportRaw: 'nba',
      seasonYear: 2026,
      seasonLabel: '2025-26',
      name: 'LAL Lakers',
      passKind: 'team',
    }

    const fetchEarnings = vi.fn(async (query) => {
      if (query.entityId === 551) {
        throw new RealApiError('upstream', 'Real API request failed (500).', 500)
      }
      return earningsResponse([{ day: '2025-11-01', earnings: 5 }])
    })
    const saveDailyEarnings = vi.fn(async (rows) => rows.length)
    const savePasses = vi.fn(async (passes) => passes.length)

    const result = await backfillRealPassEarnings([samplePass, otherPass], {
      fetchEarnings,
      loadCachedProfiles: async () => ({ profiles: [], storageConfigured: true }),
      savePasses,
      saveDailyEarnings,
      concurrency: 2,
    })

    expect(result.failures).toEqual([
      expect.objectContaining({
        externalKey: samplePass.externalKey,
        kind: 'upstream',
      }),
    ])
    expect(result.passes).toHaveLength(1)
    expect(result.passes[0]?.externalKey).toBe(otherPass.externalKey)
    expect(result.stats.fetched).toBe(1)
  })

  it('records rate_limited failures per pass without aborting siblings', async () => {
    const otherPass: EarningsBackfillPass = {
      ...samplePass,
      externalKey: '900|2026|NBA',
      entityId: 900,
      sportRaw: 'nba',
      seasonYear: 2026,
      seasonLabel: '2025-26',
      name: 'LAL Lakers',
      passKind: 'team',
    }

    const fetchEarnings = vi.fn(async (query) => {
      if (query.entityId === 551) {
        throw new RealApiError('rate_limited', 'Real API rate limited this request (429).', 429)
      }
      return earningsResponse([{ day: '2025-11-01', earnings: 5 }])
    })

    const result = await backfillRealPassEarnings([samplePass, otherPass], {
      fetchEarnings,
      loadCachedProfiles: async () => ({ profiles: [], storageConfigured: true }),
      savePasses: async (passes) => passes.length,
      saveDailyEarnings: async (rows) => rows.length,
      concurrency: 2,
    })

    expect(result.failures).toEqual([
      expect.objectContaining({
        externalKey: samplePass.externalKey,
        kind: 'rate_limited',
      }),
    ])
    expect(result.passes).toHaveLength(1)
    expect(result.passes[0]?.externalKey).toBe(otherPass.externalKey)
  })

  it('propagates an expired bot session instead of marking every pass failed', async () => {
    await expect(
      backfillRealPassEarnings([samplePass], {
        fetchEarnings: async () => {
          throw new RealApiError('auth', 'Real rejected the bot session (401).', 401)
        },
        loadCachedProfiles: async () => ({ profiles: [], storageConfigured: true }),
      }),
    ).rejects.toMatchObject({ kind: 'auth' })
  })

  /**
   * Christian McCaffrey regression: 2022 season (409) + 2023 season (624) = 1033 when
   * prior-season days leak under a 2023-24 key. Season window must keep only 624.
   */
  it('filters leaked prior-season NFL days so totals match Real info.total (CMC 1033→624)', async () => {
    const cmcPass: EarningsBackfillPass = {
      externalKey: '18877|2023|NFL',
      entityId: 18877,
      passKind: 'player',
      sportRaw: 'nfl',
      seasonYear: 2023,
      seasonLabel: '2023-24',
      name: 'Christian McCaffrey',
    }

    // Representative day totals — sums match live Real probes (409 + 624 = 1033).
    const leakedRows = [
      { day: '2022-09-25', earnings: 200 },
      { day: '2023-01-29', earnings: 209 },
      { day: '2023-09-10', earnings: 300 },
      { day: '2024-02-11', earnings: 324 },
    ]
    expect(leakedRows.reduce((sum, row) => sum + row.earnings, 0)).toBe(1033)

    const inSeason = filterDailyRowsToPassSeason(
      leakedRows.map((row) => ({ claimDay: row.day, baseRaxEarned: row.earnings })),
      2023,
      'NFL',
      '2023-24',
    )
    expect(inSeason.reduce((sum, row) => sum + row.baseRaxEarned, 0)).toBe(624)

    const fetchEarnings = vi.fn(async () => ({
      rows: leakedRows.map((row) => ({
        day: row.day,
        earnings: row.earnings,
        playerBoxScoreIds: [1],
      })),
      info: { total: 624 },
    }))
    const saveDailyEarnings = vi.fn(async (rows, options) => {
      expect(options?.replaceExternalKeys).toEqual(['18877|2023|NFL'])
      expect(rows.reduce((sum: number, row: { baseRaxEarned: number }) => sum + row.baseRaxEarned, 0)).toBe(
        624,
      )
      expect(rows.map((row: { claimDay: string }) => row.claimDay)).toEqual([
        '2023-09-10',
        '2024-02-11',
      ])
      return rows.length
    })
    const savePasses = vi.fn(async (passes) => {
      expect(passes[0]).toMatchObject({ totalBaseRax: 624, hasEarnings: true })
      return 1
    })

    const result = await backfillRealPassEarnings([cmcPass], {
      fetchEarnings,
      loadCachedProfiles: async () => ({ profiles: [], storageConfigured: true }),
      savePasses,
      saveDailyEarnings,
    })

    expect(result.passes[0]?.rows.reduce((sum, row) => sum + row.baseRaxEarned, 0)).toBe(624)
    expect(resolveBaseRaxTotal({ rowSum: 624, infoTotal: 624, filteredOutOfSeason: true })).toBe(624)
    expect(resolveBaseRaxTotal({ rowSum: 624, infoTotal: 624, filteredOutOfSeason: false })).toBe(624)
    expect(saveDailyEarnings).toHaveBeenCalled()
    expect(savePasses).toHaveBeenCalled()
  })

  it('trims prior-season days on cache hits before returning rows to the client', async () => {
    const cmcPass: EarningsBackfillPass = {
      externalKey: '18877|2023|NFL',
      entityId: 18877,
      passKind: 'player',
      sportRaw: 'nfl',
      seasonYear: 2023,
      seasonLabel: '2023-24',
      name: 'Christian McCaffrey',
    }
    const now = Date.now()
    const fetchEarnings = vi.fn()
    const result = await backfillRealPassEarnings([cmcPass], {
      fetchEarnings,
      cacheTtlMs: 60_000,
      now: () => now,
      loadCachedProfiles: async () => ({
        profiles: [
          freshProfile({
            externalKey: cmcPass.externalKey,
            entityId: 18877,
            sport: 'NFL',
            seasonYear: 2023,
            seasonLabel: '2023-24',
            name: 'Christian McCaffrey',
            totalBaseRax: 1033,
            rows: [
              { claimDay: '2022-09-25', baseRaxEarned: 409, playerBoxScoreId: 1 },
              { claimDay: '2023-09-10', baseRaxEarned: 624, playerBoxScoreId: 2 },
            ],
            cachedAt: new Date(now).toISOString(),
            sourceUpdatedAt: new Date(now).toISOString(),
          }),
        ],
        storageConfigured: true,
      }),
    })

    expect(fetchEarnings).not.toHaveBeenCalled()
    expect(result.passes[0]?.source).toBe('cache')
    expect(result.passes[0]?.rows).toEqual([
      { claimDay: '2023-09-10', baseRaxEarned: 624, playerBoxScoreId: 2 },
    ])
  })

  it('fetches Real with canonical start-year when catalog still has end-year NFL metadata', async () => {
    const misaligned: EarningsBackfillPass = {
      externalKey: '18877|2024|NFL',
      entityId: 18877,
      passKind: 'player',
      sportRaw: 'nfl',
      seasonYear: 2024,
      seasonLabel: '2023-24',
      name: 'Christian McCaffrey',
    }
    const fetchEarnings = vi.fn(async (query) => {
      expect(query.season).toBe(2023)
      return earningsResponse([{ day: '2023-09-10', earnings: 624 }])
    })

    await backfillRealPassEarnings([misaligned], {
      fetchEarnings,
      loadCachedProfiles: async () => ({ profiles: [], storageConfigured: true }),
      savePasses: async () => 1,
      saveDailyEarnings: async () => 1,
    })

    expect(fetchEarnings).toHaveBeenCalled()
  })

  it('uses NHL start-year for earnings while retaining end-year catalog metadata', async () => {
    const pass: EarningsBackfillPass = {
      externalKey: '8471675|2025|NHL',
      entityId: 8471675,
      passKind: 'player',
      sportRaw: 'nhl',
      seasonYear: 2025,
      seasonLabel: '2024-25',
      name: 'Sidney Crosby',
    }
    const fetchEarnings = vi.fn(async (query) => {
      expect(query.season).toBe(2024)
      return earningsResponse([{ day: '2025-04-17', earnings: 6 }])
    })
    const savedPasses: CatalogPassInput[] = []

    const result = await backfillRealPassEarnings([pass], {
      fetchEarnings,
      loadCachedProfiles: async () => ({ profiles: [], storageConfigured: true }),
      savePasses: async (passes) => {
        savedPasses.push(...passes)
        return passes.length
      },
      saveDailyEarnings: async (rows) => rows.length,
    })

    expect(result.passes[0]?.rows).toHaveLength(1)
    expect(savedPasses[0]).toMatchObject({
      externalKey: '8471675|2025|NHL',
      seasonYear: 2025,
      seasonLabel: '2024-25',
    })
  })
})

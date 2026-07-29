import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SHOP_CRAWL_CHUNK_TIMEOUT_MS,
  DEFAULT_SHOP_CRAWL_UI_MAX_PAGES,
  SHOP_CRAWL_CALLS_PER_PAGE,
  SHOP_CRAWL_RESUME_STORAGE_KEY,
  SHOP_CRAWL_UI_MAX_PAGES_CAP,
  advanceShopCrawlBeforeByChunks,
  advanceShopCrawlBeforeByPages,
  avatarBackfillMaxBefore,
  clearShopCrawlResumeCursor,
  estimateShopCrawlChunkTimeoutMs,
  formatShopCrawlHttpFailure,
  formatShopCrawlResumeCursor,
  linkAbortTimeout,
  loadShopCrawlResumeCursor,
  parseShopCrawlResumeCursor,
  saveShopCrawlResumeCursor,
  shopCrawlChunkTimeoutMessage,
  shopCrawlConfigsMatch,
  shopCrawlWaitingMessage,
} from './shopCrawlClient'

afterEach(() => {
  vi.useRealTimers()
})

describe('shop crawl client helpers', () => {
  it('defaults to one page per chunk and caps the UI input', () => {
    expect(DEFAULT_SHOP_CRAWL_UI_MAX_PAGES).toBe(1)
    expect(SHOP_CRAWL_UI_MAX_PAGES_CAP).toBe(5)
    expect(SHOP_CRAWL_CALLS_PER_PAGE).toBe(21)
  })

  it('computes maxBefore for a top-N avatars backfill', () => {
    expect(avatarBackfillMaxBefore(600)).toBe(580)
    expect(avatarBackfillMaxBefore(20)).toBe(0)
  })

  it('uses one Real call per page when estimating avatars-only timeouts', () => {
    // 15 × 1 × 300 + 20_000 = 24_500 → floor to 55_000
    expect(estimateShopCrawlChunkTimeoutMs(15, 300, { avatarsOnly: true })).toBe(
      DEFAULT_SHOP_CRAWL_CHUNK_TIMEOUT_MS,
    )
  })

  it('keeps a 55s floor for the default one-page chunk', () => {
    // 21 × 1500 + 20_000 = 51_500 → floor to 55_000
    expect(estimateShopCrawlChunkTimeoutMs(1, 1500)).toBe(DEFAULT_SHOP_CRAWL_CHUNK_TIMEOUT_MS)
  })

  it('scales timeout when max pages or delay grow', () => {
    // 2 × 21 × 1500 + 20_000 = 83_000
    expect(estimateShopCrawlChunkTimeoutMs(2, 1500)).toBe(83_000)
  })

  it('formats waiting and timeout messages', () => {
    expect(shopCrawlWaitingMessage(1, 12_400)).toContain('Still on chunk 1')
    expect(shopCrawlWaitingMessage(1, 12_400)).toContain('12s elapsed')
    expect(shopCrawlChunkTimeoutMessage(1, 55_000, 0, 0)).toContain('timed out after 55s')
    expect(shopCrawlChunkTimeoutMessage(1, 55_000, 2, 40)).toContain('jobIndex=2, before=40')
  })

  it('explains Vercel FUNCTION_INVOCATION_FAILED platform bodies', () => {
    const message = formatShopCrawlHttpFailure(
      500,
      'A server error has occurred FUNCTION_INVOCATION_FAILED lhr1::qpz6m-1785186113165-7df9a4e0a9a5',
    )
    expect(message).toContain('Vercel killed the function')
    expect(message).toContain('Delay ms')
    expect(message).toContain('REAL_IMPORT_ENABLED')
  })

  it('linkAbortTimeout aborts on timeout without parent abort', async () => {
    vi.useFakeTimers()
    const parent = new AbortController()
    const linked = linkAbortTimeout(100, parent.signal)
    expect(linked.timedOut()).toBe(false)
    await vi.advanceTimersByTimeAsync(120)
    expect(linked.signal.aborted).toBe(true)
    expect(linked.timedOut()).toBe(true)
    expect(parent.signal.aborted).toBe(false)
    linked.dispose()
  })

  it('linkAbortTimeout follows parent abort', () => {
    const parent = new AbortController()
    const linked = linkAbortTimeout(60_000, parent.signal)
    parent.abort()
    expect(linked.signal.aborted).toBe(true)
    expect(linked.timedOut()).toBe(false)
    linked.dispose()
  })

  it('matches resume configs after normalizing order', () => {
    expect(
      shopCrawlConfigsMatch(
        {
          seasons: [2026, 2025],
          sports: ['nba', 'nfl'],
          entityTypes: ['team', 'player'],
          includeUfc: false,
        },
        {
          seasons: [2025, 2026],
          sports: ['nfl', 'nba'],
          entityTypes: ['player', 'team'],
          includeUfc: false,
        },
      ),
    ).toBe(true)
    expect(
      shopCrawlConfigsMatch(
        {
          seasons: [2025],
          sports: ['nba'],
          entityTypes: ['player'],
          includeUfc: false,
        },
        {
          seasons: [2025],
          sports: ['nba'],
          entityTypes: ['player'],
          includeUfc: true,
        },
      ),
    ).toBe(false)
  })

  it('advances before by pages and chunks', () => {
    expect(advanceShopCrawlBeforeByPages(0, 1)).toBe(20)
    expect(advanceShopCrawlBeforeByPages(40, 2)).toBe(80)
    expect(advanceShopCrawlBeforeByChunks(0, 3, 1)).toBe(60)
    expect(advanceShopCrawlBeforeByChunks(20, 2, 2)).toBe(100)
  })

  it('formats resume cursor labels', () => {
    expect(
      formatShopCrawlResumeCursor({
        jobIndex: 2,
        before: 40,
        sport: 'nba',
        season: 2026,
        entityType: 'player',
        jobsTotal: 10,
      }),
    ).toBe('jobIndex=2 of 10 (nba/2026/player), before=40')
  })

  it('persists and loads resume cursor from storage', () => {
    const memory = new Map<string, string>()
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
      removeItem: (key: string) => {
        memory.delete(key)
      },
    }
    const saved = saveShopCrawlResumeCursor(
      {
        seasons: [2026],
        sports: ['nba'],
        entityTypes: ['player'],
        includeUfc: false,
        jobIndex: 1,
        before: 40,
        sport: 'nba',
        season: 2026,
        entityType: 'player',
        jobsTotal: 4,
      },
      storage,
    )
    expect(saved.jobIndex).toBe(1)
    expect(memory.get(SHOP_CRAWL_RESUME_STORAGE_KEY)).toContain('"before":40')
    const loaded = loadShopCrawlResumeCursor(storage)
    expect(loaded).toMatchObject({
      seasons: [2026],
      sports: ['nba'],
      entityTypes: ['player'],
      jobIndex: 1,
      before: 40,
      sport: 'nba',
    })
    expect(parseShopCrawlResumeCursor({ jobIndex: -1, before: 0, seasons: [2026] })).toBeNull()
    clearShopCrawlResumeCursor(storage)
    expect(loadShopCrawlResumeCursor(storage)).toBeNull()
  })
})

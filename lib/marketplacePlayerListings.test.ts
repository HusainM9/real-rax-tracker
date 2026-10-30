import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealApiContext } from './realApi'

const getJson = vi.hoisted(() => vi.fn())
vi.mock('./realApi.js', () => ({ realGetJson: getJson }))
import { getPlayerMarketplaceListings } from './marketplacePlayerListings'

const context = { config: {} } as RealApiContext

beforeEach(() => { getJson.mockReset(); getJson.mockResolvedValueOnce({ info: { count: 120 } }) })

describe('player marketplace listings', () => {
  it('reads every listing category, paginates and deduplicates inclusive cursors', async () => {
    const firstPage = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, status: 'open', endsAt: `2026-11-${String(i + 1).padStart(2, '0')}` }))
    getJson.mockResolvedValueOnce({ listings: firstPage })
      .mockResolvedValueOnce({ listings: [firstPage[9], { id: 11, status: 'open' }] })
      .mockResolvedValueOnce({ listings: [{ id: 12, status: 'open' }] })
      .mockResolvedValueOnce({ listings: [{ id: 13, status: 'closed' }] })
    const result = await getPlayerMarketplaceListings({ sport: 'CFB', season: 2026, entityId: 42 }, context)
    expect(result.listings).toHaveLength(12)
    expect(result.ownerCount).toBe(120)
    expect(result.incompleteTypes).toEqual([])
    expect(getJson.mock.calls.slice(1).map((call) => call[2].listingType)).toEqual(['card', 'card', 'userpassserial', 'userpassfull'])
    expect(getJson.mock.calls[0][0]).toBe('/userpasses/ncaaf/type/player/entity/42/active')
    expect(getJson.mock.calls[2][2]).toMatchObject({ sport: 'ncaaf', filterEntityId: 42, beforeEndsAt: '2026-11-10' })
  })

  it('reports a stalled cursor and failed categories without hiding successful listings', async () => {
    const page = Array.from({ length: 10 }, (_, id) => ({ id, status: 'open', endsAt: '2026-11-01' }))
    getJson.mockResolvedValueOnce({ listings: page }).mockResolvedValueOnce({ listings: page })
      .mockRejectedValueOnce(new Error('upstream failed')).mockResolvedValueOnce({ listings: [] })
    const result = await getPlayerMarketplaceListings({ sport: 'ufc', season: 2026, entityId: 42 }, context)
    expect(result.incompleteTypes).toEqual(['card', 'userpassserial'])
    expect(result.listings).toHaveLength(10)
    expect(getJson.mock.calls[1][2].filterEntityType).toBe('team')
  })

  it('limits card-only requests and does not expose account-specific upstream fields', async () => {
    const page = Array.from({ length: 10 }, (_, id) => ({ id, status: 'open', isTopBidder: true, endsAt: '2026-11-01' }))
    getJson.mockResolvedValue({ listings: page })
    const result = await getPlayerMarketplaceListings({ sport: 'nfl', season: 2026, entityId: 42, listingType: 'card' }, context)
    expect(result.incompleteTypes).toEqual(['card'])
    expect(result.listings[0]).not.toHaveProperty('isTopBidder')
    expect(getJson.mock.calls.slice(1).every((call) => call[2].listingType === 'card')).toBe(true)
  })

  it('skips auctions for players below the automatic owner threshold', async () => {
    getJson.mockReset()
    getJson.mockResolvedValueOnce({ info: { count: 99 } })
    const result = await getPlayerMarketplaceListings({ sport: 'nba', season: 2026, entityId: 1001, listingType: 'card', minimumOwners: 100 }, context)
    expect(result).toMatchObject({ ownerCount: 99, listingsSkipped: 'minimum-owners', listings: [] })
    expect(getJson).toHaveBeenCalledTimes(1)
  })

  it('leaves unknown ownership unverified and does not request auctions', async () => {
    getJson.mockReset()
    getJson.mockResolvedValueOnce({ info: {} })
    const result = await getPlayerMarketplaceListings({ sport: 'nba', season: 2026, entityId: 1002, listingType: 'card', minimumOwners: 100 }, context)
    expect(result).toMatchObject({ ownerCount: null, listingsSkipped: 'unknown-owners' })
    expect(getJson).toHaveBeenCalledTimes(1)
  })

  it('fetches auctions at exactly 100 owners and reuses the holder count', async () => {
    getJson.mockReset()
    getJson.mockResolvedValueOnce({ info: { count: 100 } }).mockResolvedValue({ listings: [] })
    const input = { sport: 'nba', season: 2026, entityId: 1003, listingType: 'card' as const, minimumOwners: 100 }
    const result = await getPlayerMarketplaceListings(input, context)
    expect(result.ownerCount).toBe(100)
    expect(result.listingsSkipped).toBeUndefined()
    await getPlayerMarketplaceListings(input, context)
    expect(getJson).toHaveBeenCalledTimes(3)
  })
})

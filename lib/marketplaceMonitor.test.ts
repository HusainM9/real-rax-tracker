import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketplaceAlertRule, MarketplaceListing } from './marketplaceAlerts'
import type { RealApiContext } from './realApi'

const mocks = vi.hoisted(() => ({
  RealApiError: class RealApiError extends Error {
    readonly kind: string
    readonly status?: number

    constructor(kind: string, message: string, status?: number) {
      super(message)
      this.kind = kind
      this.status = status
    }
  },
  realGetJson: vi.fn(),
  saveNewMarketplaceNotifications: vi.fn(),
}))

vi.mock('./realApi.js', () => ({
  RealApiError: mocks.RealApiError,
  realGetJson: mocks.realGetJson,
}))
vi.mock('./marketplaceAlertStore.js', () => ({
  saveNewMarketplaceNotifications: mocks.saveNewMarketplaceNotifications,
}))

import { scanMarketplaceAlerts } from './marketplaceMonitor'

const baseRule: MarketplaceAlertRule = {
  id: 'rule-1', name: 'NFL watch', enabled: true, sport: 'nfl', season: 2026,
  entityScope: 'all', entityId: null, entityName: '', ratingMin: null, ratingMax: null,
  rarities: [], listingMode: 'all', prestigeMode: 'all', itemType: 'serial',
  priceMin: null, priceMax: null, atTargetPrice: true, noBids: false, maxSerial: null,
  createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z',
}

const bulkListing: MarketplaceListing = {
  id: 'bulk-1', listingType: 'userpassfull', status: 'open', sport: 'nfl', season: 2026,
  entityType: 'player', entityId: 7, minBidPrice: 500, numBids: 0,
  card: { label: 'Player Seven', boostInfo: { rarityLabel: 'Rare' } },
}

const context = {
  config: {},
  signal: new AbortController().signal,
} as unknown as RealApiContext

beforeEach(() => {
  mocks.realGetJson.mockReset().mockResolvedValue({ listings: [] })
  mocks.saveNewMarketplaceNotifications.mockReset()
    .mockImplementation(async (_owner, notifications) => notifications)
})

describe('marketplace monitor', () => {
  it('groups rules into one all-rarity bulk feed even when legacy item types differ', async () => {
    const result = await scanMarketplaceAlerts({
      owner: 'husain',
      rules: [
        baseRule,
        { ...baseRule, id: 'rule-2', itemType: 'cards' },
        { ...baseRule, id: 'rule-3', itemType: 'all' },
      ],
      context,
    })

    expect(result.requests).toBe(1)
    expect(mocks.realGetJson).toHaveBeenCalledTimes(1)
    expect(mocks.realGetJson).toHaveBeenCalledWith(
      '/cardmarketplacelistings',
      context,
      expect.objectContaining({
        filterCustomType: 'all', listingType: 'userpassfull', rarity: 'all',
        sport: 'nfl', season: 2026,
      }),
    )
  })

  it('routes owned-player and owned-team scopes to distinct feeds', async () => {
    await scanMarketplaceAlerts({
      owner: 'husain',
      rules: [
        { ...baseRule, entityScope: 'ownedPlayers' },
        { ...baseRule, id: 'rule-2', entityScope: 'ownedTeams' },
      ],
      context,
    })

    expect(mocks.realGetJson).toHaveBeenCalledTimes(2)
    expect(mocks.realGetJson.mock.calls.filter((call) =>
      call[2].filterCustomType === 'ownedPlayers',
    )).toHaveLength(1)
    expect(mocks.realGetJson.mock.calls.filter((call) =>
      call[2].filterCustomType === 'ownedTeams',
    )).toHaveLength(1)
  })

  it('uses portable player-specific feeds when explicit owned player IDs are saved', async () => {
    await scanMarketplaceAlerts({
      owner: 'husain',
      rules: [{
        ...baseRule,
        entityScope: 'ownedPlayers',
        itemType: 'bulk',
        players: [{ entityId: 7, name: 'Player Seven' }],
      }],
      context,
    })

    expect(mocks.realGetJson).toHaveBeenCalledWith(
      '/cardmarketplacelistings',
      context,
      expect.objectContaining({
        filterCustomType: 'all', filterEntityType: 'player', filterEntityId: 7,
        listingType: 'userpassfull',
      }),
    )
  })

  it('targets UFC fighters through Real team filters and accepts team-typed listings', async () => {
    const ufcListing: MarketplaceListing = {
      ...bulkListing,
      id: 'ufc-3072',
      sport: 'ufc',
      season: 2023,
      entityType: 'team',
      entityId: 3072,
      teamId: 3072,
      card: { label: 'Jalin Turner', boostInfo: { rarityLabel: 'Rare' } },
    }
    mocks.realGetJson.mockResolvedValue({ listings: [ufcListing] })

    const result = await scanMarketplaceAlerts({
      owner: 'husain',
      rules: [{
        ...baseRule,
        sport: 'ufc',
        season: 2023,
        entityScope: 'ownedPlayers',
        itemType: 'bulk',
        players: [{ entityId: 3072, name: 'Jalin Turner' }],
      }],
      context,
    })

    expect(mocks.realGetJson).toHaveBeenCalledWith(
      '/cardmarketplacelistings',
      context,
      expect.objectContaining({
        sport: 'ufc',
        season: 2023,
        filterCustomType: 'all',
        filterEntityType: 'team',
        filterEntityId: 3072,
      }),
    )
    expect(result.notifications).toEqual([
      expect.objectContaining({ listingId: 'ufc-3072', playerName: 'Jalin Turner' }),
    ])
  })

  it('routes tracker sport labels to verified Real marketplace slugs', async () => {
    await scanMarketplaceAlerts({
      owner: 'husain',
      rules: [
        { ...baseRule, id: 'cfb', sport: 'cfb', rarities: ['Rare'] },
        { ...baseRule, id: 'cbb', sport: 'cbb', rarities: ['Rare'] },
        { ...baseRule, id: 'fc', sport: 'fc', rarities: ['Rare'] },
        { ...baseRule, id: 'wnba', sport: 'wnba', rarities: ['Rare'] },
      ],
      context,
    })

    expect(mocks.realGetJson.mock.calls.map((call) => call[2].sport)).toEqual([
      'ncaaf', 'ncaam', 'soccer', 'wnba',
    ])
  })

  it('scans only the bulk-rating feed for an old all-types rule', async () => {
    const result = await scanMarketplaceAlerts({
      owner: 'husain', rules: [{ ...baseRule, itemType: 'all' }], context,
    })

    expect(result.requests).toBe(1)
    expect(mocks.realGetJson.mock.calls.map((call) => call[2].listingType)).toEqual([
      'userpassfull',
    ])
  })

  it('requests all rarities once and leaves selected-rarity filtering to the matcher', async () => {
    const result = await scanMarketplaceAlerts({
      owner: 'husain',
      rules: [{ ...baseRule, rarities: ['Epic', 'Iconic'] }],
      context,
    })

    expect(result.requests).toBe(1)
    expect(mocks.realGetJson.mock.calls.map((call) => call[2].rarity)).toEqual(['all'])
  })

  it('uses one all-rarity feed per tracked player for player-specific overrides', async () => {
    const playerRule = {
      ...baseRule,
      rarities: ['Rare'] as MarketplaceAlertRule['rarities'],
      players: [
        { entityId: 7, name: 'Player Seven', rarities: ['Epic'] as MarketplaceAlertRule['rarities'] },
        { entityId: 8, name: 'Player Eight', rarities: ['Mystic'] as MarketplaceAlertRule['rarities'] },
      ],
    }
    await scanMarketplaceAlerts({ owner: 'husain', rules: [playerRule], context })
    expect(mocks.realGetJson.mock.calls.map((call) => call[2].rarity)).toEqual(['all', 'all'])
    expect(mocks.realGetJson.mock.calls.map((call) => call[2].filterEntityId).sort()).toEqual([7, 8])

    mocks.realGetJson.mockClear()
    await scanMarketplaceAlerts({
      owner: 'husain',
      rules: [{ ...playerRule, players: [{ entityId: 7, name: 'Player Seven', rarities: [] }] }],
      context,
    })
    expect(mocks.realGetJson.mock.calls.map((call) => call[2].rarity)).toEqual(['all'])
  })

  it('does not request feeds for disabled rules', async () => {
    const result = await scanMarketplaceAlerts({
      owner: 'husain', rules: [{ ...baseRule, enabled: false }], context,
    })

    expect(result).toMatchObject({ notifications: [], checkedListings: 0, requests: 0 })
    expect(mocks.realGetJson).not.toHaveBeenCalled()
  })

  it('counts unique listings and persists only matching notifications', async () => {
    mocks.realGetJson.mockResolvedValue({
      listings: [bulkListing, { ...bulkListing, id: 'closed', status: 'closed' }],
    })
    const result = await scanMarketplaceAlerts({
      owner: 'husain',
      rules: [baseRule, { ...baseRule, id: 'rule-2', entityId: 999, entityScope: 'player' }],
      context,
      foundAt: '2026-10-12T09:50:00.000Z',
    })

    expect(result.checkedListings).toBe(2)
    expect(result.notifications).toHaveLength(1)
    expect(result.notifications[0]).toMatchObject({
      id: 'rule-1:bulk-1', foundAt: '2026-10-12T09:50:00.000Z',
    })
    expect(mocks.saveNewMarketplaceNotifications).toHaveBeenCalledWith(
      'husain',
      [expect.objectContaining({ id: 'rule-1:bulk-1' })],
    )
  })

  it('keeps multiple matching auctions for the same player from the same rarity feed', async () => {
    mocks.realGetJson.mockImplementation(async (_path, _context, query) => ({
      listings: query.rarity === 'all'
        ? [
            { ...bulkListing, id: 'walker-1', value: '85.7', currentBidAmount: 3000, numBids: 1, rarity: 3 },
            { ...bulkListing, id: 'walker-2', value: '95.3', currentBidAmount: 3500, numBids: 1, rarity: 3 },
            { ...bulkListing, id: 'walker-3', value: '89.9', currentBidAmount: 3500, numBids: 1, rarity: 3 },
          ]
        : [],
    }))

    const result = await scanMarketplaceAlerts({
      owner: 'husain',
      rules: [{
        ...baseRule,
        itemType: 'bulk',
        players: [{ entityId: 7, name: 'Player Seven', pricePerRatingMax: 40 }],
        pricePerRatingMax: 40,
        atTargetPrice: true,
      }],
      context,
    })

    expect(result.checkedListings).toBe(3)
    expect(result.notifications.map((notification) => notification.listingId)).toEqual([
      'walker-1', 'walker-2', 'walker-3',
    ])
    expect(result.notifications.map((notification) => notification.rating)).toEqual([
      85.7, 95.3, 89.9,
    ])
  })

  it('deduplicates the same rule-listing candidate before persistence', async () => {
    mocks.realGetJson.mockResolvedValue({ listings: [bulkListing, bulkListing] })
    await scanMarketplaceAlerts({ owner: 'husain', rules: [baseRule], context })

    const saved = mocks.saveNewMarketplaceNotifications.mock.calls[0][1]
    expect(saved).toHaveLength(1)
  })

  it('walks every cursor page and does not stop when listings repeat', async () => {
    const listings = Array.from({ length: 19 }, (_, index) => ({
      ...bulkListing,
      id: `listing-${index + 1}`,
      value: 90,
      rarity: 3,
      endsAt: `2026-10-12T10:${String(index).padStart(2, '0')}:00.000Z`,
    }))
    mocks.realGetJson.mockImplementation(async (_path, _context, query) => {
      if (!query.beforeEndsAt) return { listings: listings.slice(0, 10) }
      if (query.beforeEndsAt === listings[9].endsAt) {
        return { listings: [listings[9], ...listings.slice(10)] }
      }
      return { listings: [listings[18]] }
    })

    const result = await scanMarketplaceAlerts({
      owner: 'husain',
      rules: [{ ...baseRule, itemType: 'bulk' }],
      context,
    })

    expect(result).toMatchObject({ checkedListings: 19, requests: 3, failedRequests: 0 })
    expect(result.notifications).toHaveLength(19)
    expect(mocks.realGetJson.mock.calls.map((call) => call[2].beforeEndsAt)).toEqual([
      undefined,
      listings[9].endsAt,
      listings[18].endsAt,
    ])
  })

  it('propagates upstream failures without marking results as saved', async () => {
    mocks.realGetJson.mockRejectedValue(new Error('Real rate limited this request'))
    await expect(scanMarketplaceAlerts({ owner: 'husain', rules: [baseRule], context }))
      .rejects.toThrow('Real rate limited this request')
    expect(mocks.saveNewMarketplaceNotifications).not.toHaveBeenCalled()
  })

  it('continues valid sports when Real rejects an unsupported sport feed', async () => {
    mocks.realGetJson.mockImplementation(async (_path, _context, query) => {
      if (query.sport === 'wnba') {
        throw new mocks.RealApiError('upstream', 'Real API request failed (400).', 400)
      }
      return { listings: query.rarity === 'all' ? [bulkListing] : [] }
    })

    const result = await scanMarketplaceAlerts({
      owner: 'husain',
      rules: [baseRule, { ...baseRule, id: 'wnba-rule', sport: 'wnba' }],
      context,
    })

    expect(result).toMatchObject({
      checkedListings: 1,
      requests: 2,
      failedRequests: 1,
      warning: '1 of 2 feeds skipped because Real rejected them (400).',
    })
    expect(result.notifications).toHaveLength(1)
    expect(mocks.saveNewMarketplaceNotifications).toHaveBeenCalledOnce()
  })
})

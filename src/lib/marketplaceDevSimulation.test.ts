import { describe, expect, it } from 'vitest'
import type { MarketplaceAlertRule } from '../../lib/marketplaceAlerts'
import {
  simulateMarketplaceBulkAuction,
  simulateMarketplaceBulkAuctions,
} from './marketplaceDevSimulation'

const rule: MarketplaceAlertRule = {
  id: 'walker-alert',
  name: 'Kenneth Walker value',
  enabled: true,
  sport: 'nfl',
  season: 2026,
  entityScope: 'ownedPlayers',
  entityId: null,
  entityName: 'Owned players',
  players: [
    { entityId: 1, name: 'Other player', rarityLabel: 'Iconic 1' },
    { entityId: 2, name: 'Kenneth Walker', rarityLabel: 'Rare', pricePerRatingMax: 40 },
  ],
  ratingMin: null,
  ratingMax: null,
  rarities: [],
  listingMode: 'all',
  prestigeMode: 'all',
  itemType: 'bulk',
  priceMin: null,
  priceMax: null,
  pricePerRatingMax: 50,
  atTargetPrice: true,
  noBids: true,
  maxSerial: null,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
}

describe('development marketplace simulation', () => {
  it('uses the customized player and creates a matching no-bid bulk auction at the exact ratio', () => {
    expect(simulateMarketplaceBulkAuction(rule, '2026-10-12T10:00:00.000Z')).toMatchObject({
      ruleId: 'walker-alert',
      playerName: 'Kenneth Walker',
      sport: 'nfl',
      season: 2026,
      price: 3400,
      rating: 85.7,
      numBids: 0,
      rarity: 'Rare',
      serialNumber: null,
      endsAt: '2026-10-12T10:10:00.000Z',
    })
  })

  it('previews multiple distinct bulk auctions for the selected player', () => {
    const notifications = simulateMarketplaceBulkAuctions(rule, '2026-10-12T10:00:00.000Z')
    expect(notifications).toHaveLength(3)
    expect(new Set(notifications.map((notification) => notification.id)).size).toBe(3)
    expect(notifications.map((notification) => notification.rating)).toEqual([85.7, 95.3, 89.9])
    expect(notifications.map((notification) => notification.price)).toEqual([3400, 3700, 3400])
    expect(notifications.every((notification) => (notification.pricePerRating ?? Infinity) <= 40)).toBe(true)
    expect(notifications.every((notification) => notification.price % 100 === 0)).toBe(true)
    expect(notifications.every((notification) => notification.rarity === 'Rare')).toBe(true)
  })

  it('uses the alert ratio and first player when no player override exists', () => {
    const noOverrides = {
      ...rule,
      players: rule.players?.map(({ entityId, name, rarityLabel }) => ({ entityId, name, rarityLabel })),
      pricePerRatingMax: 25,
    }
    const notification = simulateMarketplaceBulkAuction(noOverrides)
    expect(notification).not.toBeNull()
    if (!notification) throw new Error('Expected a simulated notification.')
    expect(notification?.playerName).toBe('Other player')
    expect(notification?.pricePerRating).toBeLessThanOrEqual(25)
    expect(notification.price % 100).toBe(0)
  })

  it('returns no notification when the simulated listing cannot satisfy the rule', () => {
    expect(simulateMarketplaceBulkAuction({ ...rule, enabled: false })).toBeNull()
    expect(simulateMarketplaceBulkAuction({ ...rule, itemType: 'serial' })).toBeNull()
    expect(simulateMarketplaceBulkAuction({ ...rule, ratingMin: 9, ratingMax: 4 })).toBeNull()
  })
})

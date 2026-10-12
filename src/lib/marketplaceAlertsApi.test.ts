import { beforeEach, describe, expect, it } from 'vitest'
import type { MarketplaceAlertNotification, MarketplaceAlertRule } from '../../lib/marketplaceAlerts'
import { scanMarketplaceAlertsNow } from './marketplaceAlertsApi'

const rule: MarketplaceAlertRule = {
  id: 'walker-alert',
  name: 'Kenneth Walker value',
  enabled: true,
  sport: 'nfl',
  season: 2026,
  entityScope: 'ownedPlayers',
  entityId: null,
  entityName: 'Owned players',
  players: [{ entityId: 23214, name: 'Kenneth Walker', pricePerRatingMax: 40 }],
  ratingMin: null,
  ratingMax: null,
  rarities: [],
  listingMode: 'all',
  prestigeMode: 'all',
  itemType: 'bulk',
  priceMin: null,
  priceMax: null,
  pricePerRatingMax: 40,
  atTargetPrice: true,
  noBids: false,
  maxSerial: null,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
}

const staleNotification: MarketplaceAlertNotification = {
  id: 'old-rule:old-listing',
  ruleId: 'old-rule',
  ruleName: 'Old alert',
  listingId: 'old-listing',
  playerName: 'Past player',
  sport: 'nfl',
  season: 2026,
  price: 999,
  numBids: 0,
  rarity: 'Rare',
  serialNumber: null,
  endsAt: null,
  foundAt: '2026-10-11T00:00:00.000Z',
}

beforeEach(() => localStorage.clear())

describe('development marketplace refresh', () => {
  it('replaces past listings and uses valid 100-RAX auction increments', async () => {
    localStorage.setItem(
      'rax-marketplace-alert-notifications-v1',
      JSON.stringify([staleNotification]),
    )

    const first = await scanMarketplaceAlertsNow([rule])
    expect(first.requests).toBe(5)
    expect(first.notifications).toHaveLength(3)
    expect(first.notifications.some((notification) => notification.id === staleNotification.id)).toBe(false)
    expect(first.notifications.map((notification) => notification.price)).toEqual([3400, 3700, 3400])
    expect(first.notifications.every((notification) => notification.price % 100 === 0)).toBe(true)

    const second = await scanMarketplaceAlertsNow([rule])
    expect(second.notifications).toHaveLength(3)
    expect(second.newNotifications).toEqual([])
  })
})

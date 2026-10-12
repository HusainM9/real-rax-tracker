import { describe, expect, it } from 'vitest'
import type { MarketplaceAlertRule } from '../../lib/marketplaceAlerts'
import { marketplaceRuleTrackingDetails } from './marketplaceRuleDetails'

const rule: MarketplaceAlertRule = {
  id: 'rule-1', name: 'NFL values', enabled: true, sport: 'nfl', season: 2026,
  entityScope: 'ownedPlayers', entityId: null, entityName: 'Owned players',
  players: [
    { entityId: 1, name: 'Default Player', rarityLabel: 'Rare 3' },
    { entityId: 2, name: 'Custom Price', pricePerRatingMax: 25 },
    { entityId: 3, name: 'All Rarities', rarities: [] },
    { entityId: 4, name: 'Two Rarities', rarities: ['Rare', 'Epic'] },
  ],
  ratingMin: 10,
  ratingMax: 100,
  rarities: ['Legendary'],
  listingMode: 'all', prestigeMode: 'all', itemType: 'bulk',
  priceMin: 500, priceMax: null, pricePerRatingMax: 40,
  atTargetPrice: true, noBids: true, maxSerial: null,
  createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z',
}

describe('marketplace rule tracking details', () => {
  it('resolves alert defaults and player-specific overrides', () => {
    const details = marketplaceRuleTrackingDetails(rule)

    expect(details).toMatchObject({
      defaultRarities: 'Legendary',
      defaultMaxRaxPerRating: 40,
      ratingRange: '10–100',
      minimumPrice: 500,
      priceBasis: 'Live target price',
      noBids: true,
    })
    expect(details.players).toEqual([
      expect.objectContaining({ name: 'Default Player', rarities: 'Legendary', maxRaxPerRating: 40, hasCustomRarities: false, hasCustomPrice: false }),
      expect.objectContaining({ name: 'Custom Price', rarities: 'Legendary', maxRaxPerRating: 25, hasCustomRarities: false, hasCustomPrice: true }),
      expect.objectContaining({ name: 'All Rarities', rarities: 'All rarities', maxRaxPerRating: 40, hasCustomRarities: true, hasCustomPrice: false }),
      expect.objectContaining({ name: 'Two Rarities', rarities: 'Rare, Epic', maxRaxPerRating: 40, hasCustomRarities: true, hasCustomPrice: false }),
    ])
  })

  it('describes unbounded defaults clearly', () => {
    const details = marketplaceRuleTrackingDetails({
      ...rule,
      players: [],
      ratingMin: null,
      ratingMax: null,
      rarities: [],
      priceMin: null,
      pricePerRatingMax: null,
      noBids: false,
    })

    expect(details).toMatchObject({
      defaultRarities: 'All rarities',
      defaultMaxRaxPerRating: null,
      ratingRange: 'Any bulk rating',
      minimumPrice: null,
      noBids: false,
      players: [],
    })
  })
})

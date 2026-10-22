import { describe, expect, it } from 'vitest'
import {
  MARKETPLACE_RARITY_API_VALUES,
  createMarketplaceNotification,
  marketplaceApiSport,
  marketplaceApiListingTypes,
  marketplaceListingMatchesRule,
  marketplaceListingTargetPrice,
  marketplaceMaximumBulkAuctionPrice,
  marketplaceListingPrice,
  marketplaceListingRarity,
  marketplaceListingRating,
  marketplaceListingUrl,
  marketplaceRuleRarities,
  parseMarketplaceAlertRule,
  type MarketplaceAlertRule,
  type MarketplaceListing,
} from './marketplaceAlerts'

describe('marketplace sport routing', () => {
  it('uses the sport slugs accepted by Real marketplace feeds', () => {
    expect(marketplaceApiSport('CFB')).toBe('ncaaf')
    expect(marketplaceApiSport('cbb')).toBe('ncaam')
    expect(marketplaceApiSport('FC')).toBe('soccer')
    expect(marketplaceApiSport('WNBA')).toBe('wnba')
    expect(marketplaceApiSport('NFL')).toBe('nfl')
  })
})

describe('marketplace listing links', () => {
  it('builds the official Real deep link from a numeric listing id', () => {
    expect(marketplaceListingUrl(787338515)).toBe('https://www.realapp.com/5ltjF5FGOb2eg')
    expect(marketplaceListingUrl('787338515')).toBe('https://www.realapp.com/5ltjF5FGOb2eg')
  })

  it('does not create broken links for demo or unsafe listing ids', () => {
    expect(marketplaceListingUrl('listing-1')).toBeNull()
    expect(marketplaceListingUrl(0)).toBeNull()
    expect(marketplaceListingUrl(Number.MAX_SAFE_INTEGER + 1)).toBeNull()
  })
})

const rule: MarketplaceAlertRule = {
  id: 'rule-1', name: 'Cheap QB', enabled: true, sport: 'nfl', season: 2026,
  entityScope: 'player', entityId: 22490, entityName: 'Trevor Lawrence',
  ratingMin: null, ratingMax: null, rarities: ['Rare'], listingMode: 'all',
  prestigeMode: 'all', itemType: 'serial', priceMin: null, priceMax: 2500,
  atTargetPrice: true, noBids: true, maxSerial: 2000,
  createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z',
}

const listing: MarketplaceListing = {
  id: 1457616609, listingType: 'userpassserial', minBidPrice: 2000,
  currentBidAmount: null, buyNowPrice: null, numBids: 0, status: 'open',
  entityType: 'player', entityId: 22490, sport: 'nfl', season: 2026,
  mintNumber: 1707, prestige: null, endsAt: '2026-10-12T10:00:00.000Z',
  card: { label: 'Trevor Lawrence', boostInfo: { rarityLabel: 'Rare' } },
}

describe('marketplace rule parsing', () => {
  it('rejects malformed values and missing required identity fields', () => {
    expect(parseMarketplaceAlertRule(null)).toBeNull()
    expect(parseMarketplaceAlertRule('rule')).toBeNull()
    expect(parseMarketplaceAlertRule({ id: '', sport: 'nfl', season: 2026 })).toBeNull()
    expect(parseMarketplaceAlertRule({ id: 'x', sport: '', season: 2026 })).toBeNull()
    expect(parseMarketplaceAlertRule({ id: 'x', sport: 'nfl', season: 'nope' })).toBeNull()
  })

  it('normalizes text, clamps numeric ranges, and removes invalid rarities', () => {
    expect(parseMarketplaceAlertRule({
      ...rule,
      name: '  Value alert  ', sport: 'NFL', season: 2026.9,
      ratingMin: -2, ratingMax: 99, priceMin: -50, maxSerial: 0,
      rarities: ['Rare', 'Rare', 'Fake', 'Iconic'],
    })).toMatchObject({
      name: 'Value alert', sport: 'nfl', season: 2026,
      ratingMin: 0, ratingMax: 99, priceMin: 0, maxSerial: 1,
      rarities: ['Rare', 'Iconic'],
    })
  })

  it('preserves the target-price Legendary-or-below filter only when enabled', () => {
    expect(parseMarketplaceAlertRule({
      ...rule,
      targetPriceLegendaryOrBelow: true,
    })).toMatchObject({ targetPriceLegendaryOrBelow: true })
    expect(parseMarketplaceAlertRule({
      ...rule,
      targetPriceLegendaryOrBelow: false,
    })).not.toHaveProperty('targetPriceLegendaryOrBelow')
  })

  it('normalizes and deduplicates explicit owned players', () => {
    expect(parseMarketplaceAlertRule({
      ...rule,
      players: [
        { entityId: 22490, name: ' Trevor Lawrence ' },
        { entityId: 22490, name: 'Duplicate', rarityLabel: ' Legendary 4 ', pricePerRatingMax: 250, rarities: ['Epic', 'Fake'], noBidsOnly: true, alwaysNotifyIconic: true, alwaysNotifyMystic: true },
        { entityId: 'bad', name: 'Invalid' },
      ],
      pricePerRatingMax: 300,
    })).toMatchObject({
      pricePerRatingMax: 300,
      players: [{ entityId: 22490, name: 'Duplicate', rarityLabel: 'Legendary 4', pricePerRatingMax: 250, rarities: ['Epic'], noBidsOnly: true, alwaysNotifyIconic: true, alwaysNotifyMystic: true }],
    })
  })

  it('uses safe defaults for unknown enum values', () => {
    expect(parseMarketplaceAlertRule({
      ...rule,
      entityScope: 'unknown', itemType: 'unknown', listingMode: 'unknown',
      prestigeMode: 'unknown', enabled: false,
    })).toMatchObject({
      entityScope: 'all', itemType: 'all', listingMode: 'all',
      prestigeMode: 'all', enabled: false,
    })
  })
})

describe('marketplace feed routing', () => {
  it('maps each rule type to the correct Real feed', () => {
    expect(marketplaceApiListingTypes('cards')).toEqual(['card'])
    expect(marketplaceApiListingTypes('serial')).toEqual(['userpassserial'])
    expect(marketplaceApiListingTypes('bulk')).toEqual(['userpassfull'])
  })

  it('requests all three distinct feeds for an all-types rule', () => {
    expect(marketplaceApiListingTypes('all')).toEqual(['card', 'userpassserial', 'userpassfull'])
  })

  it('keeps serial-number and bulk-rating matches distinct', () => {
    const bulkListing = { ...listing, listingType: 'userpassfull' }
    expect(marketplaceListingMatchesRule(rule, bulkListing)).toBe(false)
    expect(marketplaceListingMatchesRule({ ...rule, itemType: 'bulk' }, bulkListing)).toBe(true)
    expect(marketplaceListingMatchesRule({ ...rule, itemType: 'bulk' }, listing)).toBe(false)
  })

  it('requests the Iconic feed for a player override even when defaults exclude it', () => {
    expect(marketplaceRuleRarities({
      ...rule,
      rarities: ['Rare'],
      players: [{ entityId: 22490, name: 'Trevor Lawrence', alwaysNotifyIconic: true }],
    })).toEqual(['Rare', 'Iconic'])
  })

  it('requests the Mystic feed for a player override even when defaults exclude it', () => {
    expect(marketplaceRuleRarities({
      ...rule,
      rarities: ['Rare'],
      players: [{ entityId: 22490, name: 'Trevor Lawrence', alwaysNotifyMystic: true }],
    })).toEqual(['Rare', 'Mystic'])
  })

  it('matches card and all-types rules against their intended listings', () => {
    const cardListing = { ...listing, listingType: 'card' }
    expect(marketplaceListingMatchesRule({ ...rule, itemType: 'cards' }, cardListing)).toBe(true)
    expect(marketplaceListingMatchesRule({ ...rule, itemType: 'cards' }, listing)).toBe(false)
    expect(marketplaceListingMatchesRule({ ...rule, itemType: 'all' }, cardListing)).toBe(true)
    expect(marketplaceListingMatchesRule({ ...rule, itemType: 'all' }, listing)).toBe(true)
  })
})

describe('marketplace listing matching', () => {
  it('matches a no-bid listing inside every configured limit', () => {
    expect(marketplaceListingMatchesRule(rule, listing)).toBe(true)
  })

  it('requires enabled rules and open listings', () => {
    expect(marketplaceListingMatchesRule({ ...rule, enabled: false }, listing)).toBe(false)
    expect(marketplaceListingMatchesRule(rule, { ...listing, status: 'closed' })).toBe(false)
    expect(marketplaceListingMatchesRule(rule, { ...listing, status: null })).toBe(false)
  })

  it('requires the configured sport and season', () => {
    expect(marketplaceListingMatchesRule(rule, { ...listing, sport: 'nba' })).toBe(false)
    expect(marketplaceListingMatchesRule(rule, { ...listing, season: 2025 })).toBe(false)
    expect(marketplaceListingMatchesRule(rule, { ...listing, sport: 'NFL' })).toBe(true)
    expect(marketplaceListingMatchesRule(
      { ...rule, sport: 'cfb' },
      { ...listing, sport: 'ncaaf' },
    )).toBe(true)
    expect(marketplaceListingMatchesRule(
      { ...rule, sport: 'fc' },
      { ...listing, sport: 'soccer' },
    )).toBe(true)
  })

  it('handles player, team, owned, and all entity scopes', () => {
    const teamListing = { ...listing, entityType: 'team', entityId: 88, teamId: 88 }
    expect(marketplaceListingMatchesRule({ ...rule, entityScope: 'team', entityId: 88 }, teamListing)).toBe(true)
    expect(marketplaceListingMatchesRule({ ...rule, entityScope: 'ownedTeams', entityId: null }, teamListing)).toBe(true)
    expect(marketplaceListingMatchesRule({ ...rule, entityScope: 'ownedPlayers', entityId: null }, teamListing)).toBe(false)
    expect(marketplaceListingMatchesRule({ ...rule, entityScope: 'all', entityId: null }, teamListing)).toBe(true)
  })

  it('treats UFC team entities as fighters for owned-player alerts only', () => {
    const fighterListing: MarketplaceListing = {
      ...listing,
      sport: 'ufc',
      season: 2023,
      entityType: 'team',
      entityId: 3072,
      teamId: 3072,
      card: { label: 'Jalin Turner', boostInfo: { rarityLabel: 'Rare' } },
    }
    const fighterRule: MarketplaceAlertRule = {
      ...rule,
      sport: 'ufc',
      season: 2023,
      entityScope: 'ownedPlayers',
      entityId: null,
      players: [{ entityId: 3072, name: 'Jalin Turner' }],
    }

    expect(marketplaceListingMatchesRule(fighterRule, fighterListing)).toBe(true)
    expect(marketplaceListingMatchesRule(
      { ...fighterRule, sport: 'nba' },
      { ...fighterListing, sport: 'nba' },
    )).toBe(false)
  })

  it('finds entity ids in nested card payloads', () => {
    const nested = {
      ...listing,
      entityId: null,
      playerId: null,
      card: { ...listing.card, entity: { playerId: 22490 } },
    }
    expect(marketplaceListingMatchesRule(rule, nested)).toBe(true)
    expect(marketplaceListingMatchesRule({ ...rule, entityId: 999 }, nested)).toBe(false)
  })

  it('distinguishes auction and buy-now listings', () => {
    const buyNow = { ...listing, minBidPrice: null, buyNowPrice: 2000 }
    expect(marketplaceListingMatchesRule({ ...rule, listingMode: 'auction' }, listing)).toBe(true)
    expect(marketplaceListingMatchesRule({ ...rule, listingMode: 'auction' }, buyNow)).toBe(false)
    expect(marketplaceListingMatchesRule({ ...rule, listingMode: 'buyNow' }, buyNow)).toBe(true)
    expect(marketplaceListingMatchesRule({ ...rule, listingMode: 'buyNow' }, listing)).toBe(false)
  })

  it('rejects bids only when no-bids is enabled', () => {
    const bidListing = { ...listing, numBids: 1, currentBidAmount: 2100 }
    expect(marketplaceListingMatchesRule(rule, bidListing)).toBe(false)
    expect(marketplaceListingMatchesRule({ ...rule, noBids: false }, bidListing)).toBe(true)
  })

  it('distinguishes standard and prestiged listings', () => {
    expect(marketplaceListingMatchesRule({ ...rule, prestigeMode: 'standard' }, listing)).toBe(true)
    expect(marketplaceListingMatchesRule({ ...rule, prestigeMode: 'prestiged' }, listing)).toBe(false)
    const prestiged = { ...listing, prestige: 1 }
    expect(marketplaceListingMatchesRule({ ...rule, prestigeMode: 'standard' }, prestiged)).toBe(false)
    expect(marketplaceListingMatchesRule({ ...rule, prestigeMode: 'prestiged' }, prestiged)).toBe(true)
  })

  it('normalizes text and numeric Real rarity values and rejects missing rarity', () => {
    const iconic = { ...listing, card: { ...listing.card, boostInfo: { rarityLabel: 'iconic' } } }
    expect(marketplaceListingMatchesRule({ ...rule, rarities: ['Iconic'] }, iconic)).toBe(true)
    expect(marketplaceListingMatchesRule(rule, iconic)).toBe(false)
    expect(marketplaceListingMatchesRule(rule, { ...listing, card: null })).toBe(false)
    expect(marketplaceListingRarity(iconic)).toBe('Iconic')
    expect(marketplaceListingRarity({ ...listing, rarity: 5, card: {
      ...listing.card,
      boostInfo: { rarityLabel: 'Legendary 4' },
    } })).toBe('Legendary')
    expect(marketplaceListingRarity({ ...listing, rarity: '6' })).toBe('Mystic')
    expect(MARKETPLACE_RARITY_API_VALUES).toEqual({
      Rare: 3, Epic: 4, Legendary: 5, Mystic: 6, Iconic: 7,
    })
  })

  it('treats no rarity selection as all rarities and supports multiple selections', () => {
    const epic = { ...listing, card: { ...listing.card, boostInfo: { rarityLabel: 'Epic' } } }
    const mystic = { ...listing, card: { ...listing.card, boostInfo: { rarityLabel: 'Mystic' } } }
    expect(marketplaceListingMatchesRule({ ...rule, rarities: [] }, epic)).toBe(true)
    expect(marketplaceListingMatchesRule({ ...rule, rarities: [] }, { ...listing, card: null })).toBe(true)
    expect(marketplaceListingMatchesRule({ ...rule, rarities: ['Rare', 'Epic'] }, epic)).toBe(true)
    expect(marketplaceListingMatchesRule({ ...rule, rarities: ['Rare', 'Epic'] }, mystic)).toBe(false)
  })

  it('can require a configured target within the ratio limit at Legendary or below', () => {
    const targetRule = {
      ...rule,
      itemType: 'bulk' as const,
      rarities: [] as MarketplaceAlertRule['rarities'],
      priceMax: null,
      pricePerRatingMax: 40,
      noBids: false,
      targetPriceLegendaryOrBelow: true,
    }
    const rareAtTarget = {
      ...listing,
      listingType: 'userpassfull',
      rarity: 3,
      minBidPrice: 3000,
      currentBidAmount: 4000,
      buyNowPrice: 4000,
      numBids: 2,
      value: 100,
    }

    expect(marketplaceListingTargetPrice(rareAtTarget)).toBe(4000)
    expect(marketplaceListingMatchesRule(targetRule, rareAtTarget)).toBe(true)
    expect(marketplaceListingMatchesRule(targetRule, {
      ...rareAtTarget,
      currentBidAmount: 3900,
    })).toBe(true)
    expect(marketplaceListingMatchesRule(targetRule, {
      ...rareAtTarget,
      currentBidAmount: 3000,
      buyNowPrice: 4200,
    })).toBe(false)
    expect(marketplaceListingMatchesRule(targetRule, {
      ...rareAtTarget,
      buyNowPrice: null,
    })).toBe(false)
    expect(marketplaceListingMatchesRule(targetRule, {
      ...rareAtTarget,
      minBidPrice: null,
    })).toBe(false)
    expect(marketplaceListingMatchesRule(targetRule, {
      ...rareAtTarget,
      rarity: 4,
    })).toBe(true)
    expect(marketplaceListingMatchesRule(targetRule, {
      ...rareAtTarget,
      rarity: 5,
    })).toBe(true)
    expect(createMarketplaceNotification(targetRule, {
      ...rareAtTarget,
      currentBidAmount: 3000,
    })).toMatchObject({
      price: 3000,
      pricePerRating: 30,
      targetPrice: 4000,
      targetPricePerRating: 40,
    })
  })

  it('excludes Mystic and Iconic target-price listings even with player overrides', () => {
    const strictRule = {
      ...rule,
      itemType: 'bulk' as const,
      entityScope: 'ownedPlayers' as const,
      entityId: null,
      rarities: [] as MarketplaceAlertRule['rarities'],
      priceMax: null,
      noBids: false,
      targetPriceLegendaryOrBelow: true,
      players: [{
        entityId: 22490,
        name: 'Trevor Lawrence',
        alwaysNotifyIconic: true,
        alwaysNotifyMystic: true,
      }],
    }
    const atTarget = {
      ...listing,
      listingType: 'userpassfull',
      minBidPrice: 5000,
      currentBidAmount: 5000,
      buyNowPrice: 5000,
      numBids: 1,
      value: 50,
    }

    expect(marketplaceListingMatchesRule(strictRule, { ...atTarget, rarity: 6 })).toBe(false)
    expect(marketplaceListingMatchesRule(strictRule, { ...atTarget, rarity: 7 })).toBe(false)
  })

  it('matches only players in an explicit owned-player allowlist', () => {
    const ownedRule = {
      ...rule,
      entityScope: 'ownedPlayers' as const,
      entityId: null,
      players: [
        { entityId: 22490, name: 'Trevor Lawrence' },
        { entityId: 99, name: 'Another player' },
      ],
    }
    expect(marketplaceListingMatchesRule(ownedRule, listing)).toBe(true)
    expect(marketplaceListingMatchesRule(ownedRule, { ...listing, entityId: 88 })).toBe(false)
  })

  it('filters on listing price divided by bulk rating', () => {
    const rated = {
      ...listing,
      listingType: 'userpassfull',
      card: { ...listing.card, boostInfo: { rarityLabel: 'Rare', progress: 8 } },
    }
    const bulkRule = { ...rule, itemType: 'bulk' as const, priceMax: null, pricePerRatingMax: 250 }
    expect(marketplaceListingMatchesRule(bulkRule, rated)).toBe(true)
    expect(marketplaceListingMatchesRule({ ...bulkRule, pricePerRatingMax: 249 }, rated)).toBe(true)
    expect(marketplaceListingMatchesRule({ ...bulkRule, pricePerRatingMax: 248.99 }, rated)).toBe(false)
    expect(marketplaceListingMatchesRule(
      bulkRule,
      { ...rated, card: { ...rated.card, boostInfo: { rarityLabel: 'Rare', progress: 0 } } },
    )).toBe(false)
  })

  it('applies player-specific price-per-rating and rarity overrides', () => {
    const rated = {
      ...listing,
      listingType: 'userpassfull',
      card: { ...listing.card, boostInfo: { rarityLabel: 'Epic', progress: 8 } },
    }
    const playerRule = {
      ...rule,
      itemType: 'bulk' as const,
      entityScope: 'ownedPlayers' as const,
      entityId: null,
      priceMax: null,
      pricePerRatingMax: 300,
      rarities: ['Rare'] as MarketplaceAlertRule['rarities'],
      players: [{
        entityId: 22490,
        name: 'Trevor Lawrence',
        pricePerRatingMax: 240,
        rarities: ['Epic'] as MarketplaceAlertRule['rarities'],
      }],
    }
    expect(marketplaceListingMatchesRule(playerRule, rated)).toBe(false)
    expect(marketplaceListingMatchesRule({
      ...playerRule,
      players: [{ ...playerRule.players[0]!, pricePerRatingMax: 250 }],
    }, rated)).toBe(true)
    expect(marketplaceListingMatchesRule({
      ...playerRule,
      players: [{ ...playerRule.players[0]!, pricePerRatingMax: 250, rarities: [] }],
    }, { ...rated, card: { ...rated.card, boostInfo: { rarityLabel: 'Mystic', progress: 8 } } })).toBe(true)
  })

  it('can require no bids for one player without changing the alert default', () => {
    const rated = {
      ...listing,
      listingType: 'userpassfull',
      numBids: 1,
      currentBidAmount: 2000,
      value: 50,
    }
    const playerRule = {
      ...rule,
      itemType: 'bulk' as const,
      entityScope: 'ownedPlayers' as const,
      noBids: false,
      priceMax: null,
      players: [{ entityId: 22490, name: 'Trevor Lawrence', noBidsOnly: true }],
    }
    expect(marketplaceListingMatchesRule(playerRule, rated)).toBe(false)
    expect(marketplaceListingMatchesRule({
      ...playerRule,
      players: [{ entityId: 22490, name: 'Trevor Lawrence' }],
    }, rated)).toBe(true)
  })

  it('allows a player-specific Iconic override through rarity and ratio filters', () => {
    const iconic = {
      ...listing,
      listingType: 'userpassfull',
      rarity: 7,
      value: 50,
      minBidPrice: 5000,
      card: { ...listing.card, boostInfo: { rarityLabel: 'Iconic', progress: 8 } },
    }
    const playerRule = {
      ...rule,
      itemType: 'bulk' as const,
      entityScope: 'ownedPlayers' as const,
      priceMax: null,
      pricePerRatingMax: 40,
      rarities: ['Rare'] as MarketplaceAlertRule['rarities'],
      players: [{ entityId: 22490, name: 'Trevor Lawrence', alwaysNotifyIconic: true }],
    }
    expect(marketplaceListingMatchesRule(playerRule, iconic)).toBe(true)
    expect(marketplaceListingMatchesRule({
      ...playerRule,
      players: [{ entityId: 22490, name: 'Trevor Lawrence' }],
    }, iconic)).toBe(false)
    expect(createMarketplaceNotification(playerRule, iconic)).toMatchObject({
      iconicPriceOverride: true,
      maxPricePerRating: 40,
      maxAuctionPrice: null,
    })
  })

  it('allows a player-specific Mystic override through rarity and ratio filters', () => {
    const mystic = {
      ...listing,
      listingType: 'userpassfull',
      rarity: 6,
      value: 50,
      minBidPrice: 5000,
      card: { ...listing.card, boostInfo: { rarityLabel: 'Mystic', progress: 8 } },
    }
    const playerRule = {
      ...rule,
      itemType: 'bulk' as const,
      entityScope: 'ownedPlayers' as const,
      priceMax: null,
      pricePerRatingMax: 40,
      rarities: ['Rare'] as MarketplaceAlertRule['rarities'],
      players: [{ entityId: 22490, name: 'Trevor Lawrence', alwaysNotifyMystic: true }],
    }
    expect(marketplaceListingMatchesRule(playerRule, mystic)).toBe(true)
    expect(marketplaceListingMatchesRule({
      ...playerRule,
      players: [{ entityId: 22490, name: 'Trevor Lawrence' }],
    }, mystic)).toBe(false)
    expect(createMarketplaceNotification(playerRule, mystic)).toMatchObject({
      mysticPriceOverride: true,
      maxPricePerRating: 40,
      maxAuctionPrice: null,
    })
  })

  it('applies inclusive minimum and maximum prices', () => {
    expect(marketplaceListingMatchesRule({ ...rule, priceMin: 2000, priceMax: 2000 }, listing)).toBe(true)
    expect(marketplaceListingMatchesRule({ ...rule, priceMin: 2001 }, listing)).toBe(false)
    expect(marketplaceListingMatchesRule({ ...rule, priceMax: 1999 }, listing)).toBe(false)
  })

  it('can compare either the current auction price or original listing price', () => {
    const bidListing = { ...listing, numBids: 2, currentBidAmount: 3000 }
    expect(marketplaceListingMatchesRule({ ...rule, noBids: false }, bidListing)).toBe(false)
    expect(marketplaceListingMatchesRule({ ...rule, noBids: false, atTargetPrice: false }, bidListing)).toBe(true)
  })

  it('enforces serial limits using top-level or card serials', () => {
    expect(marketplaceListingMatchesRule({ ...rule, maxSerial: 1707 }, listing)).toBe(true)
    expect(marketplaceListingMatchesRule({ ...rule, maxSerial: 1706 }, listing)).toBe(false)
    const nestedSerial = { ...listing, mintNumber: null, card: { ...listing.card, serialNumber: 100 } }
    expect(marketplaceListingMatchesRule({ ...rule, maxSerial: 100 }, nestedSerial)).toBe(true)
    expect(marketplaceListingMatchesRule({ ...rule, maxSerial: 99 }, nestedSerial)).toBe(false)
    expect(marketplaceListingMatchesRule({ ...rule, maxSerial: 100 }, { ...listing, mintNumber: null, card: null })).toBe(false)
  })

  it('enforces rating ranges using progress and falls back to value', () => {
    const progress = { ...listing, card: { ...listing.card, boostInfo: { rarityLabel: 'Rare', progress: 7.5 } } }
    expect(marketplaceListingMatchesRule({ ...rule, ratingMin: 7, ratingMax: 8 }, progress)).toBe(true)
    expect(marketplaceListingMatchesRule({ ...rule, ratingMin: 8 }, progress)).toBe(false)
    const value = { ...listing, value: 6, card: { ...listing.card, boostInfo: { rarityLabel: 'Rare' } } }
    expect(marketplaceListingMatchesRule({ ...rule, ratingMin: 6, ratingMax: 6 }, value)).toBe(true)
    const unrated = { ...listing, value: null, card: { ...listing.card, boostInfo: { rarityLabel: 'Rare' } } }
    expect(marketplaceListingMatchesRule({ ...rule, ratingMin: 1 }, unrated)).toBe(false)
  })

  it('uses the bulk listing value instead of the underlying card progress', () => {
    const bulk = {
      ...listing,
      listingType: 'userpassfull',
      value: 8,
      card: { ...listing.card, boostInfo: { rarityLabel: 'Rare', progress: 3 } },
    }
    const bulkRule = { ...rule, itemType: 'bulk' as const, ratingMin: 8, ratingMax: 8 }
    expect(marketplaceListingMatchesRule(bulkRule, bulk)).toBe(true)
    expect(createMarketplaceNotification(bulkRule, bulk)).toMatchObject({
      rating: 8,
      pricePerRating: 250,
    })
  })

  it('keeps the full decimal bulk rating instead of clamping it to card-rating bounds', () => {
    const bulk = {
      ...listing,
      listingType: 'userpassfull',
      value: '105.2',
      minBidPrice: 4208,
      card: { ...listing.card, boostInfo: { rarityLabel: 'Rare', progress: 8 } },
    }
    const bulkRule = {
      ...rule,
      itemType: 'bulk' as const,
      ratingMin: 100,
      ratingMax: 110,
      priceMax: null,
      pricePerRatingMax: 40,
    }
    expect(marketplaceListingRating(bulk)).toBe(105.2)
    expect(marketplaceListingMatchesRule(bulkRule, bulk)).toBe(true)
    expect(createMarketplaceNotification(bulkRule, bulk)).toMatchObject({
      rating: 105.2,
      pricePerRating: 40,
      maxPricePerRating: 40,
      maxAuctionPrice: 4300,
    })
  })

  it('rounds the tolerated maximum down to a valid bulk-auction price step', () => {
    expect(marketplaceMaximumBulkAuctionPrice(89.7, 35)).toBe(3200)
    expect(marketplaceMaximumBulkAuctionPrice(100, 40)).toBe(4100)
    expect(marketplaceMaximumBulkAuctionPrice(null, 35)).toBeNull()
    expect(marketplaceMaximumBulkAuctionPrice(89.7, null)).toBeNull()
  })
})

describe('marketplace prices and notifications', () => {
  it('uses current bid, minimum bid, buy-now, then zero in priority order', () => {
    expect(marketplaceListingPrice(listing)).toBe(2000)
    expect(marketplaceListingPrice({ ...listing, numBids: 2, currentBidAmount: 2200 })).toBe(2200)
    expect(marketplaceListingPrice({ ...listing, minBidPrice: null, buyNowPrice: 1800 })).toBe(1800)
    expect(marketplaceListingPrice({ ...listing, minBidPrice: null, buyNowPrice: null })).toBe(0)
  })

  it('captures a seller target whenever it differs from the auction start', () => {
    expect(createMarketplaceNotification(rule, {
      ...listing,
      minBidPrice: 2_000,
      buyNowPrice: 3_500,
    })).toMatchObject({
      price: 2_000,
      startPrice: 2_000,
      targetPrice: 3_500,
      maxPrice: 2_500,
    })
  })

  it('creates a complete notification with stable rule-listing identity', () => {
    expect(createMarketplaceNotification(rule, listing, '2026-10-12T09:50:00.000Z')).toEqual({
      id: 'rule-1:1457616609', ruleId: 'rule-1', ruleName: 'Cheap QB',
      listingId: '1457616609', playerName: 'Trevor Lawrence', sport: 'nfl', season: 2026,
      price: 2000, rating: null, pricePerRating: null,
      maxPricePerRating: null, maxAuctionPrice: null,
      iconicPriceOverride: false,
      mysticPriceOverride: false,
      numBids: 0, rarity: 'Rare', serialNumber: 1707,
      endsAt: '2026-10-12T10:00:00.000Z', foundAt: '2026-10-12T09:50:00.000Z',
    })
  })

  it('falls back to the rule entity and normalizes missing listing fields', () => {
    expect(createMarketplaceNotification(
      { ...rule, entityName: 'Fallback player' },
      { ...listing, numBids: -3, mintNumber: null, endsAt: null, card: null },
    )).toMatchObject({
      playerName: 'Fallback player', numBids: 0, rarity: '', serialNumber: null, endsAt: null,
    })
  })
})

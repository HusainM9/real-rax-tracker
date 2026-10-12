import {
  MARKETPLACE_RARITIES,
  MARKETPLACE_RARITY_API_VALUES,
  createMarketplaceNotification,
  marketplaceListingMatchesRule,
  type MarketplaceAlertNotification,
  type MarketplaceAlertPlayer,
  type MarketplaceAlertRule,
  type MarketplaceListing,
  type MarketplaceRarity,
} from '../../lib/marketplaceAlerts'

function simulatedPlayer(rule: MarketplaceAlertRule): MarketplaceAlertPlayer | null {
  const configured = rule.players ?? []
  return configured.find((player) =>
    player.pricePerRatingMax !== undefined || Array.isArray(player.rarities),
  ) ?? configured[0] ?? (rule.entityId
    ? { entityId: rule.entityId, name: rule.entityName || 'Demo player' }
    : null)
}

function simulatedRarity(
  rule: MarketplaceAlertRule,
  player: MarketplaceAlertPlayer,
): MarketplaceRarity {
  const selected = player.rarities?.[0] ?? rule.rarities[0]
  if (selected) return selected
  const ownedTier = player.rarityLabel?.trim().split(/\s+/)[0]
  return MARKETPLACE_RARITIES.find((rarity) =>
    rarity.toLowerCase() === ownedTier?.toLowerCase(),
  ) ?? 'Rare'
}

export function simulateMarketplaceBulkAuctions(
  rule: MarketplaceAlertRule,
  foundAt = new Date().toISOString(),
): MarketplaceAlertNotification[] {
  const player = simulatedPlayer(rule)
  if (!player) return []

  const minimumRating = rule.ratingMin ?? 0.1
  const maximumRating = rule.ratingMax ?? Number.MAX_SAFE_INTEGER
  if (minimumRating > maximumRating || maximumRating <= 0) return []
  const preferredRatings = [85.7, 95.3, 89.9]
  const ratings = preferredRatings.filter((rating) =>
    rating >= minimumRating && rating <= maximumRating,
  )
  if (ratings.length === 0) ratings.push(Math.min(maximumRating, Math.max(minimumRating, 8)))
  const maximumPricePerRating = player.pricePerRatingMax ?? rule.pricePerRatingMax ?? 35
  const rarity = simulatedRarity(rule, player)

  return ratings.flatMap((rating, index) => {
    const pricePerRating = Math.max(0, maximumPricePerRating - index)
    // Real's bulk auctions use 100-RAX price steps. Round down so a preview
    // never exceeds the configured maximum RAX per rating.
    const price = Math.floor((rating * pricePerRating) / 100) * 100
    const listing: MarketplaceListing = {
      id: `dev-bulk-${rule.id}-${player.entityId}-${index}-${rating}-${pricePerRating}`,
      listingType: 'userpassfull',
      listingTypeDisplay: 'Bulk rating',
      minBidPrice: price,
      currentBidAmount: null,
      buyNowPrice: null,
      numBids: 0,
      status: 'open',
      entityType: 'player',
      entityId: player.entityId,
      playerId: player.entityId,
      sport: rule.sport,
      season: rule.season,
      value: rating,
      rarity: MARKETPLACE_RARITY_API_VALUES[rarity],
      prestige: rule.prestigeMode === 'prestiged' ? 1 : null,
      endsAt: new Date(Date.parse(foundAt) + 10 * 60_000).toISOString(),
      createdAt: foundAt,
      card: {
        label: player.name,
        entityType: 'player',
        entityId: player.entityId,
        boostInfo: { rarityLabel: rarity },
        entity: { id: player.entityId, playerId: player.entityId },
      },
    }

    return marketplaceListingMatchesRule(rule, listing)
      ? [createMarketplaceNotification(rule, listing, foundAt)]
      : []
  })
}

export function simulateMarketplaceBulkAuction(
  rule: MarketplaceAlertRule,
  foundAt = new Date().toISOString(),
): MarketplaceAlertNotification | null {
  return simulateMarketplaceBulkAuctions(rule, foundAt)[0] ?? null
}

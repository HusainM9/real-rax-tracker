import Hashids from 'hashids'

export const MARKETPLACE_RARITIES = ['Rare', 'Epic', 'Legendary', 'Mystic', 'Iconic'] as const
export const MARKETPLACE_PRICE_PER_RATING_ALLOWANCE = 1
export const MARKETPLACE_BULK_PRICE_INCREMENT = 100

export const MARKETPLACE_RARITY_API_VALUES = {
  Rare: 3,
  Epic: 4,
  Legendary: 5,
  Mystic: 6,
  Iconic: 7,
} as const

export type MarketplaceRarity = (typeof MARKETPLACE_RARITIES)[number]
export type MarketplaceRarityApiValue = (typeof MARKETPLACE_RARITY_API_VALUES)[MarketplaceRarity]
export type MarketplaceEntityScope = 'all' | 'player' | 'team' | 'ownedPlayers' | 'ownedTeams'
export type MarketplaceItemType = 'all' | 'cards' | 'serial' | 'bulk'
export type MarketplaceApiListingType = 'card' | 'userpassfull' | 'userpassserial'
export type MarketplaceListingMode = 'all' | 'auction' | 'buyNow'
export type MarketplacePrestigeMode = 'all' | 'standard' | 'prestiged'

/** Convert tracker/UI sport labels to the slugs accepted by Real's marketplace API. */
export function marketplaceApiSport(value: string): string {
  const sport = value.trim().toLowerCase()
  if (sport === 'cfb' || sport === 'ncaafootball' || sport === 'ncaa-football') return 'ncaaf'
  if (sport === 'cbb' || sport === 'ncaab' || sport === 'ncaabasketball') return 'ncaam'
  if (sport === 'fc') return 'soccer'
  return sport
}

export type MarketplaceAlertPlayer = {
  entityId: number
  name: string
  /** Highest owned pass rarity shown in the player picker. */
  rarityLabel?: string
  /** Optional player-specific maximum listing price divided by bulk rating. */
  pricePerRatingMax?: number
  /** Missing inherits the alert default; an empty array explicitly allows every rarity. */
  rarities?: MarketplaceRarity[]
}

export type MarketplaceAlertRule = {
  id: string
  name: string
  enabled: boolean
  sport: string
  season: number
  entityScope: MarketplaceEntityScope
  entityId: number | null
  entityName: string
  /** Explicit owned-player allowlist. Missing/empty keeps legacy whole-feed behavior. */
  players?: MarketplaceAlertPlayer[]
  ratingMin: number | null
  ratingMax: number | null
  rarities: MarketplaceRarity[]
  listingMode: MarketplaceListingMode
  prestigeMode: MarketplacePrestigeMode
  itemType: MarketplaceItemType
  priceMin: number | null
  priceMax: number | null
  /** Maximum listing price divided by the bulk rating. */
  pricePerRatingMax?: number | null
  atTargetPrice: boolean
  noBids: boolean
  maxSerial: number | null
  createdAt: string
  updatedAt: string
}

export type MarketplaceListing = {
  id: string | number
  listingType?: string | null
  listingTypeDisplay?: string | null
  minBidPrice?: number | null
  currentBidAmount?: number | null
  buyNowPrice?: number | null
  numBids?: number | null
  status?: string | null
  entityType?: string | null
  entityId?: number | null
  playerId?: number | null
  teamId?: number | null
  sport?: string | null
  season?: number | null
  mintNumber?: number | null
  rarity?: number | string | null
  prestige?: number | string | null
  value?: number | string | null
  endsAt?: string | null
  createdAt?: string | null
  card?: {
    label?: string | null
    detail?: string | null
    entityType?: string | null
    entityId?: number | null
    serialNumber?: number | null
    boostValue?: number | string | null
    boostInfo?: {
      rarityLabel?: string | null
      progress?: number | string | null
    } | null
    entity?: {
      id?: number | null
      playerId?: number | null
      teamId?: number | null
    } | null
  } | null
}

export type MarketplaceAlertNotification = {
  id: string
  ruleId: string
  ruleName: string
  listingId: string
  playerName: string
  sport: string
  season: number
  price: number
  rating?: number | null
  pricePerRating?: number | null
  /** Configured rule limit before the standard +1 RAX/rating allowance. */
  maxPricePerRating?: number | null
  /** Highest valid bulk-auction price after applying the allowance. */
  maxAuctionPrice?: number | null
  numBids: number
  rarity: string
  serialNumber: number | null
  endsAt: string | null
  foundAt: string
}

export function marketplaceMaximumBulkAuctionPrice(
  rating: number | null,
  maxPricePerRating: number | null,
): number | null {
  if (rating === null || rating <= 0 || maxPricePerRating === null) return null
  const rawMaximum = rating * (maxPricePerRating + MARKETPLACE_PRICE_PER_RATING_ALLOWANCE)
  return Math.floor(rawMaximum / MARKETPLACE_BULK_PRICE_INCREMENT) * MARKETPLACE_BULK_PRICE_INCREMENT
}

const MARKETPLACE_ROUTING_HASH = new Hashids('routing', 11)
const MARKETPLACE_LISTING_ROUTING_TYPE = 30
const GENERAL_ROUTING_SPORT = 0
const DEFAULT_ROUTING_SECTION = 0

/** Builds Real's public deep link for a marketplace listing without another API request. */
export function marketplaceListingUrl(listingId: string | number): string | null {
  const numericListingId = typeof listingId === 'number' ? listingId : Number(listingId)
  if (!Number.isSafeInteger(numericListingId) || numericListingId <= 0) return null

  const route = MARKETPLACE_ROUTING_HASH.encode(
    MARKETPLACE_LISTING_ROUTING_TYPE,
    GENERAL_ROUTING_SPORT,
    DEFAULT_ROUTING_SECTION,
    numericListingId,
  )
  return route ? `https://www.realapp.com/${route}` : null
}

const ENTITY_SCOPES = new Set<MarketplaceEntityScope>([
  'all', 'player', 'team', 'ownedPlayers', 'ownedTeams',
])
const ITEM_TYPES = new Set<MarketplaceItemType>(['all', 'cards', 'serial', 'bulk'])
const LISTING_MODES = new Set<MarketplaceListingMode>(['all', 'auction', 'buyNow'])
const PRESTIGE_MODES = new Set<MarketplacePrestigeMode>(['all', 'standard', 'prestiged'])

export function marketplaceApiListingTypes(
  itemType: MarketplaceItemType,
): MarketplaceApiListingType[] {
  if (itemType === 'cards') return ['card']
  if (itemType === 'serial') return ['userpassserial']
  if (itemType === 'bulk') return ['userpassfull']
  return ['card', 'userpassserial', 'userpassfull']
}

function finiteNumber(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  if (value === '' || value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : null
}

function stringValue(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function rarityValues(value: unknown): MarketplaceRarity[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is MarketplaceRarity =>
        MARKETPLACE_RARITIES.includes(entry as MarketplaceRarity),
      ))]
    : []
}

export function marketplaceRuleRarities(rule: MarketplaceAlertRule): MarketplaceRarity[] {
  if (!rule.players?.length) {
    return rule.rarities.length > 0 ? rule.rarities : [...MARKETPLACE_RARITIES]
  }

  const rarities = new Set<MarketplaceRarity>()
  for (const player of rule.players) {
    const allowed = Array.isArray(player.rarities) ? player.rarities : rule.rarities
    if (allowed.length === 0) return [...MARKETPLACE_RARITIES]
    allowed.forEach((rarity) => rarities.add(rarity))
  }
  return [...rarities]
}

export function parseMarketplaceAlertRule(value: unknown): MarketplaceAlertRule | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const sport = stringValue(input.sport, 20).toLowerCase()
  const season = finiteNumber(input.season, 2000, 2200)
  const id = stringValue(input.id, 80)
  if (!id || !sport || season === null) return null

  const entityScope = ENTITY_SCOPES.has(input.entityScope as MarketplaceEntityScope)
    ? input.entityScope as MarketplaceEntityScope
    : 'all'
  const itemType = ITEM_TYPES.has(input.itemType as MarketplaceItemType)
    ? input.itemType as MarketplaceItemType
    : 'all'
  const listingMode = LISTING_MODES.has(input.listingMode as MarketplaceListingMode)
    ? input.listingMode as MarketplaceListingMode
    : 'all'
  const prestigeMode = PRESTIGE_MODES.has(input.prestigeMode as MarketplacePrestigeMode)
    ? input.prestigeMode as MarketplacePrestigeMode
    : 'all'
  const rarities = rarityValues(input.rarities)
  const players = Array.isArray(input.players)
    ? [...new Map(input.players.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return []
        const player = entry as Record<string, unknown>
        const entityId = finiteNumber(player.entityId, 1)
        if (entityId === null) return []
        const pricePerRatingMax = finiteNumber(player.pricePerRatingMax, 0)
        const parsed = {
          entityId,
          name: stringValue(player.name, 120) || `Player ${entityId}`,
          ...(stringValue(player.rarityLabel, 40)
            ? { rarityLabel: stringValue(player.rarityLabel, 40) }
            : {}),
          ...(pricePerRatingMax !== null ? { pricePerRatingMax } : {}),
          ...(Array.isArray(player.rarities) ? { rarities: rarityValues(player.rarities) } : {}),
        }
        return [[entityId, parsed] as const]
      })).values()]
    : []
  const pricePerRatingMax = finiteNumber(input.pricePerRatingMax, 0)

  const now = new Date().toISOString()
  return {
    id,
    name: stringValue(input.name, 100) || 'Marketplace alert',
    enabled: input.enabled !== false,
    sport,
    season: Math.floor(season),
    entityScope,
    entityId: finiteNumber(input.entityId, 1),
    entityName: stringValue(input.entityName, 120),
    ...(players.length > 0 ? { players } : {}),
    ratingMin: finiteNumber(input.ratingMin, 0),
    ratingMax: finiteNumber(input.ratingMax, 0),
    rarities,
    listingMode,
    prestigeMode,
    itemType,
    priceMin: finiteNumber(input.priceMin, 0),
    priceMax: finiteNumber(input.priceMax, 0),
    ...(pricePerRatingMax !== null ? { pricePerRatingMax } : {}),
    atTargetPrice: input.atTargetPrice === true,
    noBids: input.noBids === true,
    maxSerial: finiteNumber(input.maxSerial, 1),
    createdAt: stringValue(input.createdAt, 40) || now,
    updatedAt: stringValue(input.updatedAt, 40) || now,
  }
}

export function marketplaceListingPrice(listing: MarketplaceListing): number {
  const current = finiteNumber(listing.currentBidAmount)
  const minimum = finiteNumber(listing.minBidPrice)
  const buyNow = finiteNumber(listing.buyNowPrice)
  if ((listing.numBids ?? 0) > 0 && current !== null) return current
  return minimum ?? buyNow ?? current ?? 0
}

function marketplaceListingOpeningPrice(listing: MarketplaceListing): number {
  return finiteNumber(listing.minBidPrice) ?? finiteNumber(listing.buyNowPrice) ?? 0
}

export function marketplaceListingRarity(listing: MarketplaceListing): string {
  const numericRarity = Number(listing.rarity)
  if (Number.isFinite(numericRarity)) {
    const match = MARKETPLACE_RARITIES.find((rarity) =>
      MARKETPLACE_RARITY_API_VALUES[rarity] === numericRarity,
    )
    if (match) return match
  }

  const label = stringValue(listing.rarity, 40) ||
    stringValue(listing.card?.boostInfo?.rarityLabel, 40)
  const tier = label.split(/\s+/)[0]?.toLowerCase()
  return MARKETPLACE_RARITIES.find((rarity) => rarity.toLowerCase() === tier) ?? ''
}

export function marketplaceListingRating(listing: MarketplaceListing): number | null {
  const value = finiteNumber(listing.value, 0)
  // Bulk-rating listings carry the amount being auctioned in `value`. A card's
  // boost progress describes the underlying pass and is not the bulk lot size.
  if (listing.listingType?.toLowerCase() === 'userpassfull' && value !== null) return value
  const progress = finiteNumber(listing.card?.boostInfo?.progress, 0)
  if (progress !== null) return progress
  return value
}

function listingEntityIds(listing: MarketplaceListing): Array<number | null | undefined> {
  return [
    listing.entityId,
    listing.playerId,
    listing.teamId,
    listing.card?.entityId,
    listing.card?.entity?.id,
    listing.card?.entity?.playerId,
    listing.card?.entity?.teamId,
  ]
}

function matchingRulePlayer(
  rule: MarketplaceAlertRule,
  listing: MarketplaceListing,
): MarketplaceAlertPlayer | undefined {
  const ids = new Set(listingEntityIds(listing).filter((id): id is number => id != null))
  return rule.players?.find((player) => ids.has(player.entityId))
}

function listingMatchesEntity(rule: MarketplaceAlertRule, listing: MarketplaceListing): boolean {
  if (rule.entityScope === 'ownedPlayers' && listing.entityType !== 'player') return false
  if (rule.entityScope === 'ownedTeams' && listing.entityType !== 'team') return false
  if (rule.entityScope === 'player' && listing.entityType !== 'player') return false
  if (rule.entityScope === 'team' && listing.entityType !== 'team') return false
  const ids = listingEntityIds(listing)
  if ((rule.players?.length ?? 0) > 0) {
    const allowedIds = new Set(rule.players!.map((player) => player.entityId))
    return ids.some((id) => id != null && allowedIds.has(id))
  }
  if (rule.entityId === null) return true
  return ids.some((id) => id === rule.entityId)
}

export function marketplaceListingMatchesRule(
  rule: MarketplaceAlertRule,
  listing: MarketplaceListing,
): boolean {
  if (!rule.enabled || listing.status !== 'open') return false
  if (
    marketplaceApiSport(listing.sport ?? '') !== marketplaceApiSport(rule.sport) ||
    Number(listing.season) !== rule.season
  ) return false
  if (!listingMatchesEntity(rule, listing)) return false

  const listingType = listing.listingType?.toLowerCase() ?? ''
  if (rule.itemType === 'cards' && listingType !== 'card') return false
  if (rule.itemType === 'serial' && listingType !== 'userpassserial') return false
  if (rule.itemType === 'bulk' && listingType !== 'userpassfull') return false
  if (rule.listingMode === 'auction' && finiteNumber(listing.minBidPrice) === null) return false
  if (rule.listingMode === 'buyNow' && finiteNumber(listing.buyNowPrice) === null) return false
  if (rule.noBids && Number(listing.numBids ?? 0) !== 0) return false

  const hasPrestige = listing.prestige !== null && listing.prestige !== undefined
  if (rule.prestigeMode === 'standard' && hasPrestige) return false
  if (rule.prestigeMode === 'prestiged' && !hasPrestige) return false

  const player = matchingRulePlayer(rule, listing)
  const allowedRarities = player && Array.isArray(player.rarities)
    ? player.rarities
    : rule.rarities
  const rarity = marketplaceListingRarity(listing).toLowerCase()
  if (allowedRarities.length > 0 && !allowedRarities.some((entry) => entry.toLowerCase() === rarity)) {
    return false
  }

  const price = rule.atTargetPrice
    ? marketplaceListingPrice(listing)
    : marketplaceListingOpeningPrice(listing)
  if (rule.priceMin !== null && price < rule.priceMin) return false
  if (rule.priceMax !== null && price > rule.priceMax) return false
  const pricePerRatingMax = player?.pricePerRatingMax ?? rule.pricePerRatingMax ?? null
  const rating = marketplaceListingRating(listing)
  if (pricePerRatingMax !== null) {
    if (
      rating === null ||
      rating <= 0 ||
      price / rating > pricePerRatingMax + MARKETPLACE_PRICE_PER_RATING_ALLOWANCE
    ) return false
  }
  const serial = finiteNumber(listing.mintNumber ?? listing.card?.serialNumber, 1)
  if (rule.maxSerial !== null && (serial === null || serial > rule.maxSerial)) return false

  if (rule.ratingMin !== null || rule.ratingMax !== null) {
    if (rating === null) return false
    if (rule.ratingMin !== null && rating < rule.ratingMin) return false
    if (rule.ratingMax !== null && rating > rule.ratingMax) return false
  }
  return true
}

export function createMarketplaceNotification(
  rule: MarketplaceAlertRule,
  listing: MarketplaceListing,
  foundAt = new Date().toISOString(),
): MarketplaceAlertNotification {
  const listingId = String(listing.id)
  const price = marketplaceListingPrice(listing)
  const rating = marketplaceListingRating(listing)
  const player = matchingRulePlayer(rule, listing)
  const maxPricePerRating = player?.pricePerRatingMax ?? rule.pricePerRatingMax ?? null
  return {
    id: `${rule.id}:${listingId}`,
    ruleId: rule.id,
    ruleName: rule.name,
    listingId,
    playerName: stringValue(listing.card?.label, 120) || rule.entityName || 'Marketplace listing',
    sport: rule.sport,
    season: rule.season,
    price,
    rating,
    pricePerRating: rating && rating > 0 ? price / rating : null,
    maxPricePerRating,
    maxAuctionPrice: marketplaceMaximumBulkAuctionPrice(rating, maxPricePerRating),
    numBids: Math.max(0, Number(listing.numBids ?? 0)),
    rarity: marketplaceListingRarity(listing),
    serialNumber: finiteNumber(listing.mintNumber ?? listing.card?.serialNumber, 1),
    endsAt: stringValue(listing.endsAt, 40) || null,
    foundAt,
  }
}

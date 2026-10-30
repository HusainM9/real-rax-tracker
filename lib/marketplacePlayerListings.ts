import { marketplaceApiSport, marketplaceApiListingTypes, type MarketplaceApiListingType, type MarketplaceListing } from './marketplaceAlerts.js'
import { realGetJson, type RealApiContext } from './realApi.js'

const PAGE_SIZE = 10
const MAX_PAGES = 30

export type PlayerMarketplaceResult = {
  listings: MarketplaceListing[]
  incompleteTypes: MarketplaceApiListingType[]
  fetchedAt: string
  ownerCount?: number | null
  listingsSkipped?: 'minimum-owners' | 'unknown-owners'
}

const holderCounts = new Map<string, { value: number; expiresAt: number }>()

/** Real renders info.count from this seasonal endpoint beside its Card holders heading. */
async function getHolderCount(input: { sport: string; season: number; entityId: number }, context: RealApiContext): Promise<number | null> {
  const key = `${input.sport}|${input.season}|${input.entityId}`
  const cached = holderCounts.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  try {
    const data = await realGetJson<{ info?: { count?: unknown } }>(`/userpasses/${encodeURIComponent(input.sport)}/type/${input.sport === 'ufc' ? 'team' : 'player'}/entity/${input.entityId}/active`, context, { season: input.season })
    const raw = data.info?.count
    const value = typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : null
    if (value !== null) {
      holderCounts.set(key, { value, expiresAt: Date.now() + 5 * 60_000 })
      if (holderCounts.size > 1000) holderCounts.delete(holderCounts.keys().next().value!)
    }
    return value
  } catch {
    if (context.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return null
  }
}

/** Do not expose fields tied to the configured Real account, such as isTopBidder. */
function publicListing(listing: MarketplaceListing): MarketplaceListing {
  return {
    id: listing.id, listingType: listing.listingType, listingTypeDisplay: listing.listingTypeDisplay,
    minBidPrice: listing.minBidPrice, currentBidAmount: listing.currentBidAmount,
    buyNowPrice: listing.buyNowPrice, numBids: listing.numBids, status: listing.status,
    entityType: listing.entityType, entityId: listing.entityId, playerId: listing.playerId,
    teamId: listing.teamId, sport: listing.sport, season: listing.season,
    mintNumber: listing.mintNumber, rarity: listing.rarity, prestige: listing.prestige,
    value: listing.value, endsAt: listing.endsAt, createdAt: listing.createdAt,
    card: listing.card ? {
      label: listing.card.label, detail: listing.card.detail, entityType: listing.card.entityType,
      entityId: listing.card.entityId, serialNumber: listing.card.serialNumber,
      boostValue: listing.card.boostValue, boostInfo: listing.card.boostInfo ? {
        rarityLabel: listing.card.boostInfo.rarityLabel, progress: listing.card.boostInfo.progress,
      } : null,
    } : null,
  }
}

/** Reads all three marketplace categories independently; Real's timestamp cursor is inclusive. */
export async function getPlayerMarketplaceListings(
  input: { sport: string; season: number; entityId: number; listingType?: MarketplaceApiListingType; minimumOwners?: number },
  context: RealApiContext,
): Promise<PlayerMarketplaceResult> {
  const sport = marketplaceApiSport(input.sport)
  const ownerCount = await getHolderCount({ ...input, sport }, context)
  if (input.minimumOwners && (ownerCount === null || ownerCount < input.minimumOwners)) {
    return {
      listings: [], incompleteTypes: [], ownerCount, fetchedAt: new Date().toISOString(),
      listingsSkipped: ownerCount === null ? 'unknown-owners' : 'minimum-owners',
    }
  }
  const unique = new Map<string, MarketplaceListing>()
  const incompleteTypes: MarketplaceApiListingType[] = []
  for (const listingType of input.listingType ? [input.listingType] : marketplaceApiListingTypes('all')) {
    let cursor: string | undefined
    let complete = false
    try {
      // A page of player counts can fan out to multiple requests. Bound the card
      // walk and report a lower bound when a particularly active feed exceeds it.
      const maxPages = input.listingType === 'card' ? 10 : MAX_PAGES
      for (let page = 0; page < maxPages; page += 1) {
        const data = await realGetJson<{ listings?: MarketplaceListing[] }>(
          '/cardmarketplacelistings', context, {
            cohort: 'all', filterCustomType: 'all',
            filterEntityType: sport === 'ufc' ? 'team' : 'player',
            filterEntityId: input.entityId, listingType, prestige: 'all', rarity: 'all',
            season: input.season, sport, beforeEndsAt: cursor,
          },
        )
        if (!Array.isArray(data.listings)) break
        const listings = data.listings
        for (const listing of listings) {
          if (listing.id != null && listing.status === 'open') unique.set(String(listing.id), publicListing(listing))
        }
        if (listings.length < PAGE_SIZE) { complete = true; break }
        const next = listings.reduce<string | undefined>((latest, listing) => {
          const end = listing.endsAt
          return typeof end === 'string' && end && (!latest || end > latest) ? end : latest
        }, undefined)
        if (!next || next === cursor) break
        cursor = next
      }
    } catch {
      if (context.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    }
    if (!complete) incompleteTypes.push(listingType)
  }
  return { listings: [...unique.values()], incompleteTypes, ownerCount, fetchedAt: new Date().toISOString() }
}

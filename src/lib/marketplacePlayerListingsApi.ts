import { safeFetch } from "./safeImportFetch"
import type { MarketplaceListing } from '../../lib/marketplaceAlerts'
import type { PlayerMarketplaceResult } from '../../lib/marketplacePlayerListings'
import { readResponseJson } from './readResponseJson'
import type { CatalogSearchResult } from './catalogApi'

const CACHE_MS = 60_000
const cache = new Map<string, PlayerMarketplaceResult>()

/** Real stores the seller's target in buyNowPrice; count only cards that have reached it. */
export function cardReachedTarget(listing: MarketplaceListing): boolean {
  if (listing.status !== 'open' || listing.listingType?.toLowerCase() !== 'card') return false
  if (listing.buyNowPrice == null || listing.currentBidAmount == null) return false
  const target = Number(listing.buyNowPrice)
  const current = Number(listing.currentBidAmount)
  return Number.isFinite(target) && target > 0 && Number.isFinite(current) && current >= target
}

export type PlayerListingSort = 'name' | 'rax' | 'cards' | 'owners' | 'listed'
export type PlayerListingSortDirection = 'asc' | 'desc'

export function playerMeetsOwnerMinimum(result?: PlayerMarketplaceResult, minimum = 100): boolean {
  return typeof result?.ownerCount === 'number' && Number.isSafeInteger(result.ownerCount) && result.ownerCount >= minimum
}

export function playerCardCounts(result?: PlayerMarketplaceResult): { listed?: number; target?: number } {
  if (!result || result.listingsSkipped) return {}
  const cards = result.listings.filter((listing) => listing.status === 'open' && listing.listingType?.toLowerCase() === 'card')
  // A failed feed is not evidence of zero listings.
  if (cards.length === 0 && result.incompleteTypes.includes('card')) return {}
  return { listed: cards.length, target: cards.filter(cardReachedTarget).length }
}

/** Unchecked players remain unknown and sort after every checked count, including zero. */
export function sortMarketplacePlayers(
  players: CatalogSearchResult[], sort: PlayerListingSort, counts: Record<number, number | undefined>,
  options: { direction?: PlayerListingSortDirection; ownerCounts?: Record<number, number | null | undefined>; listedCounts?: Record<number, number | undefined> } = {},
): CatalogSearchResult[] {
  const direction = options.direction ?? (sort === 'name' ? 'asc' : 'desc')
  const multiplier = direction === 'asc' ? 1 : -1
  return [...players].sort((a, b) => {
    if (sort === 'name') return multiplier * a.name.localeCompare(b.name)
    const value = (player: CatalogSearchResult) => sort === 'rax' ? player.totalBaseRax
      : sort === 'owners' ? options.ownerCounts?.[player.entityId]
      : sort === 'listed' ? options.listedCounts?.[player.entityId] : counts[player.entityId]
    const aCount = value(a)
    const bCount = value(b)
    if (aCount == null && bCount != null) return 1
    if (aCount != null && bCount == null) return -1
    if (aCount != null && bCount != null && aCount !== bCount) return multiplier * (aCount - bCount)
    return a.name.localeCompare(b.name)
  })
}

export class PlayerListingsRequestError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

export async function fetchPlayerCards(sport: string, season: number, entityId: number, signal?: AbortSignal, refresh = false, minimumOwners = 0): Promise<PlayerMarketplaceResult> {
  const key = `${sport}|${season}|${entityId}|${minimumOwners}`
  const cached = cache.get(key)
  if (!refresh && cached && Date.now() - Date.parse(cached.fetchedAt) < CACHE_MS) return cached
  const params = new URLSearchParams({ sport, season: String(season), entityId: String(entityId), listingType: 'card' })
  if (minimumOwners > 0) params.set('minimumOwners', String(minimumOwners))
  const response = await safeFetch(`/api/account/marketplace-player-listings?${params}`, { credentials: 'include', signal })
  const body = await readResponseJson<PlayerMarketplaceResult & { error?: string }>(response)
  if (!response.ok) throw new PlayerListingsRequestError(body.error || `Could not load player listings (${response.status}).`, response.status)
  cache.set(key, body)
  if (cache.size > 1000) cache.delete(cache.keys().next().value!)
  return body
}

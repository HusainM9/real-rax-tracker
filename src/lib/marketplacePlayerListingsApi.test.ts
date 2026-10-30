import { describe, expect, it } from 'vitest'
import { cardReachedTarget, playerCardCounts, playerMeetsOwnerMinimum, sortMarketplacePlayers } from './marketplacePlayerListingsApi'
import type { PlayerMarketplaceResult } from '../../lib/marketplacePlayerListings'
import type { CatalogSearchResult } from './catalogApi'

describe('card target price', () => {
  it('counts open cards that meet a positive seller target, not bulk listings or cards below target', () => {
    const card = { id: 1, listingType: 'card', status: 'open', buyNowPrice: 100, currentBidAmount: 100 }
    expect(cardReachedTarget(card)).toBe(true)
    expect(cardReachedTarget({ ...card, currentBidAmount: 110 })).toBe(true)
    expect(cardReachedTarget({ ...card, currentBidAmount: 90 })).toBe(false)
    expect(cardReachedTarget({ ...card, buyNowPrice: null })).toBe(false)
    expect(cardReachedTarget({ ...card, listingType: 'userpassfull' })).toBe(false)
    expect(cardReachedTarget({ ...card, status: 'closed' })).toBe(false)
  })
})

describe('player listing sort', () => {
  const players = [
    { entityId: 1, name: 'A', totalBaseRax: 20 },
    { entityId: 2, name: 'B', totalBaseRax: 50 },
    { entityId: 3, name: 'C', totalBaseRax: 10 },
  ] as CatalogSearchResult[]
  it('sorts by earned RAX and keeps unchecked counts distinct from zero', () => {
    expect(sortMarketplacePlayers(players, 'rax', {}).map((player) => player.entityId)).toEqual([2, 1, 3])
    expect(sortMarketplacePlayers(players, 'cards', { 1: 0, 3: 4 }).map((player) => player.entityId)).toEqual([3, 1, 2])
  })
  it('supports both header directions and keeps unknown numbers last in either direction', () => {
    expect(sortMarketplacePlayers(players, 'rax', {}, { direction: 'asc' }).map((player) => player.entityId)).toEqual([3, 1, 2])
    expect(sortMarketplacePlayers(players, 'name', {}, { direction: 'desc' }).map((player) => player.entityId)).toEqual([3, 2, 1])
    expect(sortMarketplacePlayers(players, 'cards', { 1: 0, 3: 4 }, { direction: 'asc' }).map((player) => player.entityId)).toEqual([1, 3, 2])
    expect(sortMarketplacePlayers(players, 'owners', {}, { ownerCounts: { 1: 100, 2: 400, 3: null } }).map((player) => player.entityId)).toEqual([2, 1, 3])
    expect(sortMarketplacePlayers(players, 'listed', {}, { direction: 'asc', listedCounts: { 1: 8, 3: 0 } }).map((player) => player.entityId)).toEqual([3, 1, 2])
  })
})

describe('automatic ownership qualification and listing counts', () => {
  const result = { ownerCount: 100, listings: [], incompleteTypes: [], fetchedAt: '2026-10-30' } as PlayerMarketplaceResult
  it('only includes verified players with at least 100 owners', () => {
    expect(playerMeetsOwnerMinimum(result)).toBe(true)
    expect(playerMeetsOwnerMinimum({ ...result, ownerCount: 99 })).toBe(false)
    expect(playerMeetsOwnerMinimum({ ...result, ownerCount: null })).toBe(false)
    expect(playerMeetsOwnerMinimum(undefined)).toBe(false)
    expect(playerMeetsOwnerMinimum({ ...result, ownerCount: NaN })).toBe(false)
  })
  it('counts open individual cards separately from cards at target and excludes bulk auctions', () => {
    expect(playerCardCounts({ ...result, listings: [
      { id: 1, listingType: 'card', status: 'open', buyNowPrice: 10, currentBidAmount: 10 },
      { id: 2, listingType: 'card', status: 'open', buyNowPrice: 10, currentBidAmount: 9 },
      { id: 3, listingType: 'userpassfull', status: 'open', buyNowPrice: 10, currentBidAmount: 10 },
      { id: 4, listingType: 'card', status: 'closed', buyNowPrice: 10, currentBidAmount: 10 },
    ] })).toEqual({ listed: 2, target: 1 })
  })
  it('never turns skipped or failed feeds into authoritative zero counts', () => {
    expect(playerCardCounts({ ...result, listingsSkipped: 'minimum-owners' })).toEqual({})
    expect(playerCardCounts({ ...result, incompleteTypes: ['card'] })).toEqual({})
    expect(playerCardCounts(result)).toEqual({ listed: 0, target: 0 })
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import {
  getCachedMarketplacePlayers,
  MARKETPLACE_PLAYER_CACHE_KEY,
  saveCachedMarketplacePlayers,
} from './marketplacePlayerCache'

const loadedAt = '2026-10-12T05:30:00.000Z'

describe('marketplace player cache', () => {
  beforeEach(() => localStorage.clear())

  it('saves and restores a sorted player list for the same account, sport, and season', () => {
    expect(saveCachedMarketplacePlayers('@Gordon', 'NFL', 2026, [
      { entityId: 1, name: 'Rare player', rarityLabel: 'Rare 10', pricePerRatingMax: 100 },
      { entityId: 2, name: 'Iconic player', rarityLabel: 'Iconic 1', rarities: ['Iconic'] },
    ], loadedAt)).toBe(true)

    expect(getCachedMarketplacePlayers('gordon', 'nfl', 2026)).toEqual({
      username: 'gordon',
      sport: 'nfl',
      season: 2026,
      loadedAt,
      players: [
        { entityId: 2, name: 'Iconic player', rarityLabel: 'Iconic 1' },
        { entityId: 1, name: 'Rare player', rarityLabel: 'Rare 10' },
      ],
    })
  })

  it('isolates cached lists by account, sport, and season', () => {
    saveCachedMarketplacePlayers('gordon', 'nfl', 2026, [{ entityId: 1, name: 'NFL player' }], loadedAt)
    saveCachedMarketplacePlayers('gordon', 'nba', 2026, [{ entityId: 2, name: 'NBA player' }], loadedAt)
    saveCachedMarketplacePlayers('other', 'nfl', 2026, [{ entityId: 3, name: 'Other user' }], loadedAt)
    saveCachedMarketplacePlayers('gordon', 'nfl', 2025, [{ entityId: 4, name: 'Old season' }], loadedAt)

    expect(getCachedMarketplacePlayers('gordon', 'nfl', 2026)?.players[0]?.name).toBe('NFL player')
    expect(getCachedMarketplacePlayers('gordon', 'nba', 2026)?.players[0]?.name).toBe('NBA player')
    expect(getCachedMarketplacePlayers('other', 'nfl', 2026)?.players[0]?.name).toBe('Other user')
    expect(getCachedMarketplacePlayers('gordon', 'nfl', 2025)?.players[0]?.name).toBe('Old season')
    expect(getCachedMarketplacePlayers('missing', 'nfl', 2026)).toBeNull()
  })

  it('overwrites only the matching cache entry after a Real reload', () => {
    saveCachedMarketplacePlayers('gordon', 'nfl', 2026, [{ entityId: 1, name: 'Before' }], loadedAt)
    saveCachedMarketplacePlayers('gordon', 'nba', 2026, [{ entityId: 2, name: 'NBA' }], loadedAt)
    saveCachedMarketplacePlayers('GORDON', 'NFL', 2026, [{ entityId: 3, name: 'After' }], '2026-10-12T06:00:00.000Z')

    expect(getCachedMarketplacePlayers('@gordon', 'nfl', 2026)?.players).toEqual([
      { entityId: 3, name: 'After' },
    ])
    expect(getCachedMarketplacePlayers('gordon', 'nba', 2026)?.players[0]?.name).toBe('NBA')
  })

  it('handles malformed JSON and unsupported cache versions safely', () => {
    localStorage.setItem(MARKETPLACE_PLAYER_CACHE_KEY, '{bad json')
    expect(getCachedMarketplacePlayers('gordon', 'nfl', 2026)).toBeNull()

    localStorage.setItem(MARKETPLACE_PLAYER_CACHE_KEY, JSON.stringify({ version: 2, entries: [] }))
    expect(getCachedMarketplacePlayers('gordon', 'nfl', 2026)).toBeNull()
  })

  it('drops invalid rows, deduplicates ids, and keeps an empty successful load', () => {
    localStorage.setItem(MARKETPLACE_PLAYER_CACHE_KEY, JSON.stringify({
      version: 1,
      entries: [{
        username: '@Gordon',
        sport: 'NFL',
        season: 2026,
        loadedAt,
        players: [
          { entityId: 2, name: 'First' },
          { entityId: 2, name: 'Replacement', rarityLabel: '  Epic 3  ' },
          { entityId: 0, name: 'Invalid id' },
          { entityId: 4, name: '' },
          null,
        ],
      }],
    }))

    expect(getCachedMarketplacePlayers('gordon', 'nfl', 2026)?.players).toEqual([
      { entityId: 2, name: 'Replacement', rarityLabel: 'Epic 3' },
    ])

    expect(saveCachedMarketplacePlayers('gordon', 'mlb', 2026, [], loadedAt)).toBe(true)
    expect(getCachedMarketplacePlayers('gordon', 'mlb', 2026)?.players).toEqual([])
  })

  it('fails without throwing when storage is unavailable or rejects writes', () => {
    expect(saveCachedMarketplacePlayers('gordon', 'nfl', 2026, [], loadedAt, null)).toBe(false)
    expect(getCachedMarketplacePlayers('gordon', 'nfl', 2026, null)).toBeNull()

    const rejectingStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota exceeded') },
    }
    expect(saveCachedMarketplacePlayers('gordon', 'nfl', 2026, [], loadedAt, rejectingStorage)).toBe(false)
  })
})

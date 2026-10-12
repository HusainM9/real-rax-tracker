import type { MarketplaceAlertPlayer } from '../../lib/marketplaceAlerts'
import { compareMarketplacePlayersByRarity } from './marketplaceOwnedPlayers'

export const MARKETPLACE_PLAYER_CACHE_KEY = 'real-rax-tracker:marketplace-player-cache:v1'
const MAX_CACHE_ENTRIES = 40

type PlayerCacheStorage = Pick<Storage, 'getItem' | 'setItem'>

export type MarketplacePlayerCacheEntry = {
  username: string
  sport: string
  season: number
  players: MarketplaceAlertPlayer[]
  loadedAt: string
}

type MarketplacePlayerCache = {
  version: 1
  entries: MarketplacePlayerCacheEntry[]
}

function browserStorage(): PlayerCacheStorage | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

function normalizedUsername(value: string): string {
  return value.replace(/^@/, '').trim().toLowerCase()
}

function normalizedSport(value: string): string {
  return value.trim().toLowerCase()
}

function cacheEntryKey(username: string, sport: string, season: number): string {
  return `${normalizedUsername(username)}\u0000${normalizedSport(sport)}\u0000${Math.floor(season)}`
}

function parsePlayer(value: unknown): MarketplaceAlertPlayer | null {
  if (!value || typeof value !== 'object') return null
  const player = value as Record<string, unknown>
  const entityId = Number(player.entityId)
  if (!Number.isSafeInteger(entityId) || entityId < 1) return null
  const name = typeof player.name === 'string' ? player.name.trim().slice(0, 120) : ''
  if (!name) return null
  const rarityLabel = typeof player.rarityLabel === 'string'
    ? player.rarityLabel.trim().slice(0, 40)
    : ''
  return {
    entityId,
    name,
    ...(rarityLabel ? { rarityLabel } : {}),
  }
}

function parseEntry(value: unknown): MarketplacePlayerCacheEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  const username = typeof entry.username === 'string' ? normalizedUsername(entry.username) : ''
  const sport = typeof entry.sport === 'string' ? normalizedSport(entry.sport) : ''
  const season = Number(entry.season)
  const loadedAt = typeof entry.loadedAt === 'string' && Number.isFinite(Date.parse(entry.loadedAt))
    ? entry.loadedAt
    : ''
  if (!username || !sport || !Number.isSafeInteger(season) || season < 2000 || season > 2200 || !loadedAt) {
    return null
  }

  const players = Array.isArray(entry.players)
    ? [...new Map(entry.players.flatMap((value) => {
        const player = parsePlayer(value)
        return player ? [[player.entityId, player] as const] : []
      })).values()].sort(compareMarketplacePlayersByRarity)
    : []

  return { username, sport, season, players, loadedAt }
}

function readCache(storage: PlayerCacheStorage | null = browserStorage()): MarketplacePlayerCache {
  if (!storage) return { version: 1, entries: [] }
  try {
    const raw = storage.getItem(MARKETPLACE_PLAYER_CACHE_KEY)
    if (!raw) return { version: 1, entries: [] }
    const parsed = JSON.parse(raw) as { version?: unknown; entries?: unknown }
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] }
    }
    return {
      version: 1,
      entries: parsed.entries
        .map(parseEntry)
        .filter((entry): entry is MarketplacePlayerCacheEntry => entry !== null),
    }
  } catch {
    return { version: 1, entries: [] }
  }
}

export function getCachedMarketplacePlayers(
  username: string,
  sport: string,
  season: number,
  storage: PlayerCacheStorage | null = browserStorage(),
): MarketplacePlayerCacheEntry | null {
  const key = cacheEntryKey(username, sport, season)
  return readCache(storage).entries.find((entry) =>
    cacheEntryKey(entry.username, entry.sport, entry.season) === key,
  ) ?? null
}

export function saveCachedMarketplacePlayers(
  username: string,
  sport: string,
  season: number,
  players: MarketplaceAlertPlayer[],
  loadedAt = new Date().toISOString(),
  storage: PlayerCacheStorage | null = browserStorage(),
): boolean {
  if (!storage) return false
  const entry = parseEntry({ username, sport, season, players, loadedAt })
  if (!entry) return false
  const key = cacheEntryKey(entry.username, entry.sport, entry.season)
  const retained = readCache(storage).entries.filter((candidate) =>
    cacheEntryKey(candidate.username, candidate.sport, candidate.season) !== key,
  )
  try {
    storage.setItem(MARKETPLACE_PLAYER_CACHE_KEY, JSON.stringify({
      version: 1,
      entries: [entry, ...retained].slice(0, MAX_CACHE_ENTRIES),
    } satisfies MarketplacePlayerCache))
    return true
  } catch {
    return false
  }
}

import { isPlayerLikeCatalogPass } from '../../lib/passKind'
import type { MarketplaceAlertPlayer } from '../../lib/marketplaceAlerts'
import type { RealPassImportResult } from './realPassImport'

const RARITY_TIERS = [
  'Iconic',
  'Mystic',
  'Legendary',
  'Epic',
  'Rare',
  'Uncommon',
  'Common',
] as const

function raritySortValue(rarityLabel: string | undefined): { tier: number; level: number } {
  const label = rarityLabel?.trim() ?? ''
  const [rawTier = '', rawLevel = ''] = label.split(/\s+/)
  const tier = RARITY_TIERS.findIndex((entry) => entry.toLowerCase() === rawTier.toLowerCase())
  const parsedLevel = Number.parseInt(rawLevel, 10)
  return {
    tier: tier === -1 ? RARITY_TIERS.length : tier,
    level: Number.isFinite(parsedLevel) ? parsedLevel : 0,
  }
}

export function compareMarketplacePlayersByRarity(
  left: MarketplaceAlertPlayer,
  right: MarketplaceAlertPlayer,
): number {
  const leftRarity = raritySortValue(left.rarityLabel)
  const rightRarity = raritySortValue(right.rarityLabel)
  if (leftRarity.tier !== rightRarity.tier) return leftRarity.tier - rightRarity.tier
  if (leftRarity.level !== rightRarity.level) return rightRarity.level - leftRarity.level
  const nameOrder = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  return nameOrder || left.entityId - right.entityId
}

function canonicalSport(value: string): string {
  const sport = value.trim().toLowerCase()
  if (sport === 'cfb') return 'ncaaf'
  if (sport === 'cbb') return 'ncaam'
  if (sport === 'soccer') return 'fc'
  return sport
}

export function realOwnedMarketplacePlayers(
  result: RealPassImportResult,
  sport: string,
  season: number,
): MarketplaceAlertPlayer[] {
  const requestedSport = canonicalSport(sport)
  const players = new Map<number, MarketplaceAlertPlayer>()

  for (const pass of [...result.playerPasses, ...result.teamPasses]) {
    if (canonicalSport(pass.sportRaw) !== requestedSport || pass.season !== season) continue
    if (!isPlayerLikeCatalogPass({ passKind: pass.passKind, sport: pass.sportRaw })) continue
    const player: MarketplaceAlertPlayer = {
      entityId: pass.entityId,
      name: pass.playerName?.trim() || `Player ${pass.entityId}`,
      ...(pass.rarityLabel?.trim() ? { rarityLabel: pass.rarityLabel.trim().slice(0, 40) } : {}),
    }
    const existing = players.get(pass.entityId)
    if (!existing || compareMarketplacePlayersByRarity(player, existing) < 0) {
      players.set(pass.entityId, player)
    }
  }

  return [...players.values()].sort(compareMarketplacePlayersByRarity)
}

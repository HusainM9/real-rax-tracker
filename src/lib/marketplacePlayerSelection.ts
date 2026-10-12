import type { MarketplaceAlertPlayer } from '../../lib/marketplaceAlerts'

export function initialMarketplacePlayerSelection(
  availablePlayers: MarketplaceAlertPlayer[],
  currentPlayers: MarketplaceAlertPlayer[],
): number[] {
  const availableIds = new Set(availablePlayers.map((player) => player.entityId))
  if (currentPlayers.length === 0) return availablePlayers.map((player) => player.entityId)
  return currentPlayers
    .map((player) => player.entityId)
    .filter((entityId) => availableIds.has(entityId))
}

export function applyMarketplacePlayerSelection(
  availablePlayers: MarketplaceAlertPlayer[],
  currentPlayers: MarketplaceAlertPlayer[],
  selectedIds: Iterable<number>,
): MarketplaceAlertPlayer[] {
  const selected = new Set(selectedIds)
  const currentById = new Map(currentPlayers.map((player) => [player.entityId, player]))

  return availablePlayers.flatMap((player) => {
    if (!selected.has(player.entityId)) return []
    const current = currentById.get(player.entityId)
    return [{
      ...player,
      ...(current?.pricePerRatingMax !== undefined
        ? { pricePerRatingMax: current.pricePerRatingMax }
        : {}),
      ...(Array.isArray(current?.rarities) ? { rarities: current.rarities } : {}),
      ...(current?.noBidsOnly === true ? { noBidsOnly: true } : {}),
      ...(current?.alwaysNotifyIconic === true ? { alwaysNotifyIconic: true } : {}),
    }]
  })
}

export function filterMarketplacePlayers(
  players: MarketplaceAlertPlayer[],
  query: string,
): MarketplaceAlertPlayer[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return players
  return players.filter((player) =>
    player.name.toLocaleLowerCase().includes(normalized)
    || player.rarityLabel?.toLocaleLowerCase().includes(normalized),
  )
}

import type { MarketplaceAlertRule } from '../../lib/marketplaceAlerts'

function rarityLabel(rarities: MarketplaceAlertRule['rarities']): string {
  return rarities.length > 0 ? rarities.join(', ') : 'All rarities'
}

function ratingRange(rule: MarketplaceAlertRule): string {
  if (rule.ratingMin != null && rule.ratingMax != null) {
    return rule.ratingMin === rule.ratingMax
      ? rule.ratingMin.toLocaleString()
      : `${rule.ratingMin.toLocaleString()}–${rule.ratingMax.toLocaleString()}`
  }
  if (rule.ratingMin != null) return `${rule.ratingMin.toLocaleString()} or higher`
  if (rule.ratingMax != null) return `Up to ${rule.ratingMax.toLocaleString()}`
  return 'Any bulk rating'
}

export function marketplaceRuleTrackingDetails(rule: MarketplaceAlertRule) {
  return {
    defaultRarities: rarityLabel(rule.rarities),
    defaultMaxRaxPerRating: rule.pricePerRatingMax ?? null,
    ratingRange: ratingRange(rule),
    minimumPrice: rule.priceMin ?? null,
    priceBasis: rule.atTargetPrice ? 'Current auction price' : 'Opening price',
    targetPriceLegendaryOrBelow: rule.targetPriceLegendaryOrBelow === true,
    noBids: rule.noBids,
    players: (rule.players ?? []).map((player) => {
      const hasCustomRarities = Array.isArray(player.rarities)
      const hasCustomPrice = player.pricePerRatingMax !== undefined
      const noBidsOnly = player.noBidsOnly === true
      const alwaysNotifyIconic = player.alwaysNotifyIconic === true
      const alwaysNotifyMystic = player.alwaysNotifyMystic === true
      const effectiveRarities = hasCustomRarities ? player.rarities! : rule.rarities
      return {
        entityId: player.entityId,
        name: player.name,
        ownedRarity: player.rarityLabel?.trim() || null,
        rarities: rarityLabel(effectiveRarities),
        maxRaxPerRating: player.pricePerRatingMax ?? rule.pricePerRatingMax ?? null,
        hasCustomRarities,
        hasCustomPrice,
        noBidsOnly,
        alwaysNotifyIconic,
        alwaysNotifyMystic,
      }
    }),
  }
}

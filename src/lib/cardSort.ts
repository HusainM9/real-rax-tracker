import type { CardRollup, Sport } from '../types/rax'
import { normalizeRarityTier, RARITY_TIERS, legendaryPlusRarityFilter, type RarityTier } from './rarityFilter'

export type RarityFilterValue = 'All' | 'Legendary+' | 'Unknown' | RarityTier

export type CardSortKey =
  | 'baseRax'
  | 'claimable'
  | 'overlap'
  | 'guaranteed'
  | 'proBonus'
  | 'entries'
  | 'name'
  | 'sport'
  | 'season'

export type SortDirection = 'asc' | 'desc'

export const CARD_SORT_OPTIONS: { value: CardSortKey; label: string }[] = [
  { value: 'baseRax', label: 'Total base RAX' },
  { value: 'claimable', label: 'Total claimable RAX' },
  { value: 'overlap', label: 'Overlapped RAX' },
  { value: 'guaranteed', label: 'Guaranteed RAX' },
  { value: 'proBonus', label: 'Pro bonus RAX' },
  { value: 'entries', label: 'Entry count' },
  { value: 'name', label: 'Player name' },
  { value: 'sport', label: 'Sport' },
  { value: 'season', label: 'Season' },
]

export function compareCardsBySortKey(a: CardRollup, b: CardRollup, sortKey: CardSortKey): number {
  if (sortKey === 'name') {
    return a.card.name.localeCompare(b.card.name)
  }
  if (sortKey === 'sport') {
    return a.card.sport.localeCompare(b.card.sport) || a.card.name.localeCompare(b.card.name)
  }
  if (sortKey === 'season') {
    return a.card.season.localeCompare(b.card.season) || a.card.name.localeCompare(b.card.name)
  }

  const aValue =
    sortKey === 'baseRax'
      ? a.totalBaseRax
      : sortKey === 'claimable'
        ? a.totalClaimableRax
        : sortKey === 'overlap'
          ? a.overlapRax
          : sortKey === 'guaranteed'
            ? a.guaranteedRax
            : sortKey === 'proBonus'
              ? a.proBonusRax
              : a.performanceCount
  const bValue =
    sortKey === 'baseRax'
      ? b.totalBaseRax
      : sortKey === 'claimable'
        ? b.totalClaimableRax
        : sortKey === 'overlap'
          ? b.overlapRax
          : sortKey === 'guaranteed'
            ? b.guaranteedRax
            : sortKey === 'proBonus'
              ? b.proBonusRax
              : b.performanceCount

  return aValue - bValue || a.card.name.localeCompare(b.card.name)
}

export function sortCards(
  cards: CardRollup[],
  primary: CardSortKey,
  direction: SortDirection,
  secondary: CardSortKey | null = null,
): CardRollup[] {
  const multiplier = direction === 'asc' ? 1 : -1
  return [...cards].sort((a, b) => {
    let result = compareCardsBySortKey(a, b, primary)
    if (result !== 0) return result * multiplier
    if (secondary) {
      result = compareCardsBySortKey(a, b, secondary)
      if (result !== 0) return result * multiplier
    }
    return a.card.name.localeCompare(b.card.name) * multiplier
  })
}

export function filterCardsBySport(cards: CardRollup[], sport: Sport | 'All'): CardRollup[] {
  if (sport === 'All') return cards
  return cards.filter((rollup) => rollup.card.sport === sport)
}

export function cardRarityTier(card: CardRollup['card']): RarityTier | 'Unknown' {
  const label = card.rarityLabel?.trim()
  if (!label) return 'Unknown'

  const tier = normalizeRarityTier(label)
  return tier === 'Other' ? 'Unknown' : tier
}

export function filterCardsByRarity(
  cards: CardRollup[],
  selectedTiers: Set<RarityTier>,
  includeUnknown: boolean,
): CardRollup[] {
  const showAll = includeUnknown && selectedTiers.size === RARITY_TIERS.length
  if (showAll) return cards

  return cards.filter((rollup) => {
    const tier = cardRarityTier(rollup.card)
    if (tier === 'Unknown') return includeUnknown
    return selectedTiers.has(tier)
  })
}

export function filterCardsByRarityPreset(
  cards: CardRollup[],
  filter: RarityFilterValue,
): CardRollup[] {
  if (filter === 'All') return cards
  if (filter === 'Legendary+') {
    return filterCardsByRarity(cards, legendaryPlusRarityFilter(), false)
  }
  if (filter === 'Unknown') {
    return cards.filter((rollup) => cardRarityTier(rollup.card) === 'Unknown')
  }
  return cards.filter((rollup) => cardRarityTier(rollup.card) === filter)
}
